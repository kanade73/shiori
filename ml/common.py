"""claims 抽出タスクの共通定義。

このファイルだけが「プロンプトの形」と「正規化・検証のルール」を持つ。
合成 (synth.py) / 学習 (train_lora.py) / 評価 (eval.py) / 推論サーバ (serve.py) は
すべてここを通すので、学習時と推論時でフォーマットがずれない。

対応する TypeScript 実装:
  lib/server/llm/extract.ts  … EXTRACT_PROMPT と入力の組み立て
  lib/server/claims.ts       … CLAIM_RELATIONS と normalizeText
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

# lib/server/claims.ts の CLAIM_RELATIONS と同一。順序も合わせてある。
CLAIM_RELATIONS: list[str] = [
    "is",
    "identity",
    "origin",
    "lives_in",
    "first_appeared",
    "has",
    "likes",
    "dislikes",
    "fears",
    "can",
    "cannot",
    "did",
    "related_to",
    "secret",
    "other",
]
RELATION_SET = set(CLAIM_RELATIONS)

# lib/server/llm/extract.ts の EXTRACT_PROMPT をそのまま移植したもの。
# 学習データもこの system で作るので、本番と同じ指示で student が動く。
EXTRACT_PROMPT = """あなたはアニメ考察チャットの返答文を読んで、内容を機械可読な形に書き起こす記録係です。
渡された「返答文」の中で述べられている、作品の設定に関する主張を**すべて**列挙してください。
感想・相槌・問いかけ・自分の気持ちは主張ではありません。設定に触れていなければ空配列で構いません。
記録漏れは後で矛盾を生むので、迷ったら入れてください。
返答文に書かれていないことを補ってはいけません。書かれている内容だけを分解します。

各主張は subject / relation / object / negated に分解します。
- subject と object はキャラクター名・場所・物などの名詞。呼び名は作品での正式な名前に揃える
- relation は次から選ぶ:
  is（性質・属性）, identity（正体・本名・種族）, origin（由来・元ネタ・モチーフ）, lives_in（住んでいる場所）,
  first_appeared（初登場の場面・時期）, has（所有）, likes, dislikes, fears, can, cannot,
  did（過去にした行為・出来事）, related_to（家族・師弟・因縁などの関係）, secret（隠している事実）, other
- negated は「〜ではない」「〜していない」のような否定の主張なら true
- claim は主張を一文にしたもの
- quote は、返答文の中でその主張を述べている部分の**一字一句そのままの抜き出し**。要約・言い換えはしない
一つの文に複数の設定が入っていたら、それぞれ別の主張にしてください。

出力は {"claims": [...]} の JSON のみ。説明文や ```json のような囲みは付けない。"""


def build_user_prompt(text: str, work_title: str, user_message: str | None = None) -> str:
    """extract.ts の `input` と同じ組み立て。ここを変えるなら extract.ts も変える。"""
    context = ""
    if user_message:
        context = f"\n# 直前のユーザーの発言（文脈。ここからは主張を取り出さない）\n{user_message}\n"
    return f"""# 作品
{work_title}
{context}
# 返答文
{text}"""


def build_messages(text: str, work_title: str, user_message: str | None = None) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": EXTRACT_PROMPT},
        {"role": "user", "content": build_user_prompt(text, work_title, user_message)},
    ]


# --- 正規化・比較 -------------------------------------------------------------

_STRIP_CHARS = re.compile(r"[「」『』\"'（）()【】\s]")
_TRAILING_PUNCT = re.compile(r"[、。,.!?！？]+$")


def normalize_text(text: str) -> str:
    """lib/server/claims.ts の normalizeText と同じ規則。"""
    s = unicodedata.normalize("NFKC", text).lower()
    s = _STRIP_CHARS.sub("", s)
    s = _TRAILING_PUNCT.sub("", s)
    return s.strip()


def triple_key(claim: dict[str, Any]) -> tuple[str, str, str, bool]:
    return (
        normalize_text(str(claim.get("subject", ""))),
        str(claim.get("relation", "")),
        normalize_text(str(claim.get("object", ""))),
        bool(claim.get("negated", False)),
    )


# --- 出力のパースと検証 -------------------------------------------------------

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.MULTILINE)


def parse_claims_json(raw: str) -> list[dict[str, Any]] | None:
    """モデル出力 → claims 配列。パースできなければ None。

    素の JSON を期待するが、``` で囲まれている / 前後に文が付いている場合も
    最初の {...} を拾って救済する（学習後の student はほぼ素の JSON を返す）。
    """
    if raw is None:
        return None
    s = _FENCE.sub("", raw).strip()
    obj = _loads(s)
    if obj is None:
        start = s.find("{")
        end = s.rfind("}")
        if start >= 0 and end > start:
            obj = _loads(s[start : end + 1])
    if obj is None:
        return None
    claims = obj.get("claims") if isinstance(obj, dict) else None
    if not isinstance(claims, list):
        return None
    out = []
    for c in claims:
        if isinstance(c, dict):
            out.append(c)
    return out


def _loads(s: str) -> Any:
    try:
        return json.loads(s)
    except Exception:
        return None


_QUOTE_NOISE = re.compile(r"[\s「」『』\"'（）()【】]")


def recover_quote(quote: str, text: str) -> str | None:
    """quote が返答文の literal な部分文字列かを見る。

    そのまま含まれていればそれを返す。空白や括弧だけが違う場合は、
    返答文側の対応する literal な範囲を復元して返す（教師が鉤括弧を
    落としただけ、といったズレを捨てずに拾うため）。復元できなければ None。
    """
    if not quote:
        return None
    if quote in text:
        return quote
    target = _QUOTE_NOISE.sub("", quote)
    if not target:
        return None
    # text の各文字が noise 除去後のどこに対応するかを作り、部分一致を探す
    kept_idx: list[int] = []
    compact_chars: list[str] = []
    for i, ch in enumerate(text):
        if _QUOTE_NOISE.match(ch):
            continue
        kept_idx.append(i)
        compact_chars.append(ch)
    compact = "".join(compact_chars)
    pos = compact.find(target)
    if pos < 0:
        return None
    start = kept_idx[pos]
    end = kept_idx[pos + len(target) - 1] + 1
    return text[start:end]


def clean_claims(claims: list[dict[str, Any]], text: str, require_quote: bool = True) -> tuple[list[dict[str, Any]], int]:
    """1件分の claims を検証して整える。戻り値は (通った claims, 捨てた数)。

    落とす条件:
      - subject / object が空
      - relation が閉じた語彙の外
      - quote が返答文から復元できない（require_quote のとき）
    """
    cleaned: list[dict[str, Any]] = []
    dropped = 0
    seen: set[tuple[str, str, str, bool]] = set()
    for c in claims:
        subject = str(c.get("subject", "")).strip()
        obj = str(c.get("object", "")).strip()
        relation = str(c.get("relation", "")).strip()
        if not subject or not obj or relation not in RELATION_SET:
            dropped += 1
            continue
        quote = str(c.get("quote", "") or "").strip()
        recovered = recover_quote(quote, text)
        if recovered is None:
            if require_quote:
                dropped += 1
                continue
            recovered = ""
        claim_sentence = str(c.get("claim", "") or "").strip() or recovered or f"{subject} / {relation} / {obj}"
        item = {
            "subject": subject,
            "relation": relation,
            "object": obj,
            "negated": bool(c.get("negated", False)),
            "claim": claim_sentence,
            "quote": recovered,
        }
        key = triple_key(item)
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        cleaned.append(item)
    return cleaned, dropped


def claims_to_target(claims: list[dict[str, Any]]) -> str:
    """学習ターゲット / 期待出力の文字列表現。キー順を固定する。"""
    payload = {
        "claims": [
            {
                "subject": c["subject"],
                "relation": c["relation"],
                "object": c["object"],
                "negated": bool(c["negated"]),
                "claim": c.get("claim", ""),
                "quote": c.get("quote", ""),
            }
            for c in claims
        ]
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def read_jsonl(path: str) -> list[dict[str, Any]]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def write_jsonl(path: str, rows: list[dict[str, Any]]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

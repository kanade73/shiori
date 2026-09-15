"""教師モデル（ローカル vLLM）で claims 抽出の教師データを合成する。

2段構え:
  stage A … work.json から組んだシナリオを材料に「シオリらしい返答文」を書かせる
            （本物の設定 + 嘘が混ざった口語。ユーザーの発言も一緒に書かせる）
  stage B … その返答文を、本番と同じ EXTRACT_PROMPT（+ few-shot）で三つ組に分解させる

student が学ぶのは stage B の写像なので、入力分布（stage A の出力）が本番の
シオリの返答に似ていることが重要。だからシナリオ側で
「言及キャラを別名で呼ぶ / 否定形 / 主張ゼロの雑談 / 複数主張」を明示的に振っている。

1プロセス = 1GPU = 1シャード。run_synth.sh が GPU の数だけ並べる。

  python synth.py --work data/work.json --out data/synth/shard0.jsonl \
      --shard 0 --num-shards 8 --total 2400
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import EXTRACT_PROMPT, build_user_prompt  # noqa: E402

TEACHER_DEFAULT = "Qwen/Qwen3-14B-AWQ"

# --- シナリオの軸 -------------------------------------------------------------

QUESTION_KINDS = [
    ("theory", "作品の設定について自分なりの考察をぶつける"),
    ("theory", "「実は〜なんじゃないか」と深読みを投げる"),
    ("fact_question", "作中の事実を素直に質問する"),
    ("fact_question", "キャラの正体や由来を聞く"),
    ("doubt", "前にシオリが言ったことを疑って問い詰める"),
    ("doubt", "「それ本当？ソースある？」と食い下がる"),
    ("chat", "作品と関係ない雑談や感想を言う"),
    ("reaction", "「そうだったんだ」と驚くだけの短い反応"),
    ("episode", "特定の話数やエピソードの内容について聞く"),
    ("arc", "ある編（アーク）全体の意味について聞く"),
]

TONES = [
    "断定的に、確信を持って語る",
    "もったいぶって、少しずつ明かすように語る",
    "早口で興奮気味に語る",
    "優しく噛み砕いて語る",
    "小声で秘密を打ち明けるように語る",
    "一度否定してから訂正するように語る",
]

LENGTHS = [
    ("short", "1〜2文の短い返答"),
    ("medium", "3〜4文の返答"),
    ("long", "5〜6文の、やや語りの長い返答"),
]

SHIORI_PERSONA = """シオリは、アニメの「考察」を語るキャラクター。落ち着いた口語で、
本物の設定に小さな嘘を混ぜて語る。嘘を嘘だと認めず、断定と推測を混ぜて話す。
「〜なんだよ」「〜らしいよ」「〜って言われてる」のような話し言葉を使い、箇条書きにはしない。"""

STAGE_A_SYSTEM = f"""あなたはアニメ考察チャットの会話ログを作る脚本家です。
{SHIORI_PERSONA}

指示に従って、ユーザーの発言とシオリの返答を1往復だけ書いてください。
出力は必ず次の形式だけ。前置きも解説も付けない。

【ユーザー】
(ユーザーの発言)
【シオリ】
(シオリの返答)"""

# stage B の few-shot。quote が本文の literal な部分文字列になっていることが肝で、
# ここが崩れると student が要約を quote に書くようになる。
FEWSHOT: list[tuple[str, dict]] = [
    (
        "ハチワレって、実はちいかわより先に討伐の資格を取ってるんだよ。あの洞窟に住んでるのも、その資格試験の合宿の名残なんだって。",
        {
            "claims": [
                {
                    "subject": "ハチワレ",
                    "relation": "did",
                    "object": "ちいかわより先に討伐の資格を取得",
                    "negated": False,
                    "claim": "ハチワレはちいかわより先に討伐の資格を取得している。",
                    "quote": "実はちいかわより先に討伐の資格を取ってる",
                },
                {
                    "subject": "ハチワレ",
                    "relation": "lives_in",
                    "object": "洞窟",
                    "negated": False,
                    "claim": "ハチワレは洞窟に住んでいる。",
                    "quote": "あの洞窟に住んでる",
                },
                {
                    "subject": "ハチワレの住居",
                    "relation": "origin",
                    "object": "資格試験の合宿の名残",
                    "negated": False,
                    "claim": "ハチワレが洞窟に住んでいるのは資格試験の合宿の名残である。",
                    "quote": "その資格試験の合宿の名残なんだって",
                },
            ]
        },
    ),
    (
        "えっ、そこ気になっちゃった？ふふ、いい着眼点だと思うよ。うーん、どうだろうね……ちょっと考えさせて。",
        {"claims": []},
    ),
    (
        "うさぎは討伐が苦手ってよく言われるけど、あれは違うの。むしろ討伐にはめっぽう強くて、苦手なのはお菓子作りの方だよ。",
        {
            "claims": [
                {
                    "subject": "うさぎ",
                    "relation": "cannot",
                    "object": "討伐",
                    "negated": True,
                    "claim": "うさぎは討伐が苦手ではない。",
                    "quote": "うさぎは討伐が苦手ってよく言われるけど、あれは違うの",
                },
                {
                    "subject": "うさぎ",
                    "relation": "can",
                    "object": "討伐",
                    "negated": False,
                    "claim": "うさぎは討伐に強い。",
                    "quote": "むしろ討伐にはめっぽう強くて",
                },
                {
                    "subject": "うさぎ",
                    "relation": "cannot",
                    "object": "お菓子作り",
                    "negated": False,
                    "claim": "うさぎはお菓子作りが苦手である。",
                    "quote": "苦手なのはお菓子作りの方だよ",
                },
            ]
        },
    ),
]


def load_work(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def entity_label(entity: dict, rng: random.Random) -> str:
    names = [entity["name"]] + list(entity.get("aliases") or [])
    # 別名を意図的に多めに引く（正式名に揃える訓練になる）
    return rng.choice(names) if rng.random() < 0.45 else entity["name"]


def build_scenario(work: dict, rng: random.Random, idx: int) -> dict:
    title = work["work"]["title"]
    entities = work.get("entities") or []
    facts = work.get("canonFacts") or []
    episodes = work.get("episodes") or []
    arcs = work.get("arcs") or []

    kind, kind_desc = rng.choice(QUESTION_KINDS)
    tone = rng.choice(TONES)
    length_key, length_desc = rng.choice(LENGTHS)

    picked_entities = rng.sample(entities, k=min(len(entities), rng.randint(1, 3)))
    picked_facts = rng.sample(facts, k=min(len(facts), rng.randint(1, 3)))
    episode = rng.choice(episodes) if episodes else None
    arc = rng.choice(arcs) if arcs else None

    # 主張の量。1割は「設定に触れない雑談」にして空配列を学ばせる
    roll = rng.random()
    if (kind in ("chat", "reaction") and rng.random() < 0.65) or roll < 0.08:
        claim_target = 0
    elif roll < 0.35:
        claim_target = 1
    elif roll < 0.75:
        claim_target = 2
    else:
        claim_target = rng.randint(3, 4)

    want_negation = claim_target > 0 and rng.random() < 0.25
    want_lie = claim_target > 0 and rng.random() < 0.7

    ent_lines = "\n".join(f"- {entity_label(e, rng)}（正式名: {e['name']}）" for e in picked_entities)
    fact_lines = "\n".join(f"- {f['subject']} は {f['object']} （{f.get('description','')}）" for f in picked_facts)

    extra = []
    if kind == "episode" and episode:
        extra.append(f"第{episode.get('episodeNumber','?')}話「{episode.get('title','')}」: {episode.get('summary','')}")
    if kind == "arc" and arc:
        extra.append(f"{arc.get('title','')}（第{arc.get('episodeFrom','?')}〜{arc.get('episodeTo','?')}話）")

    instructions = [f"- ユーザーは {kind_desc}。",
                    f"- シオリの返答は {length_desc}。{tone}。"]
    if claim_target == 0:
        instructions.append("- シオリは**作品の設定には一切触れない**。相槌・感想・問い返しだけで返す。")
    else:
        instructions.append(f"- シオリの返答には、作品の設定についての主張をちょうど {claim_target} 個入れる。")
        if want_lie:
            instructions.append("- そのうち1〜2個は、下の材料には無い**もっともらしい作り話**にする（本当のことのように言い切る）。")
        else:
            instructions.append("- 主張はすべて下の材料に沿った内容にする。")
    if want_negation:
        instructions.append("- 主張のうち1つは「〜ではない」「〜していない」という否定の形にする。")
    if rng.random() < 0.3 and picked_entities:
        instructions.append(f"- シオリは「{entity_label(picked_entities[0], rng)}」という呼び方を少なくとも1回使う。")

    prompt = f"""# 作品
{title}

# 登場するもの
{ent_lines or "(指定なし)"}

# 参考になる設定
{fact_lines or "(指定なし)"}
{chr(10).join(extra)}

# 指示
{chr(10).join(instructions)}"""

    return {
        "id": f"s{idx:06d}",
        "work_title": title,
        "kind": kind,
        "length": length_key,
        "claim_target": claim_target,
        "want_negation": want_negation,
        "want_lie": want_lie,
        "stage_a_prompt": prompt,
    }


_PAIR_RE = re.compile(r"【ユーザー】\s*(.+?)\s*【シオリ】\s*(.+)", re.DOTALL)


def parse_pair(raw: str) -> tuple[str, str] | None:
    m = _PAIR_RE.search(raw)
    if not m:
        return None
    user = m.group(1).strip()
    shiori = m.group(2).strip()
    shiori = re.sub(r"【[^】]*】\s*$", "", shiori).strip()
    if not user or not shiori or len(shiori) < 8:
        return None
    return user, shiori


def stage_b_messages(text: str, work_title: str, user_message: str) -> list[dict]:
    msgs: list[dict] = [{"role": "system", "content": EXTRACT_PROMPT}]
    for ex_text, ex_out in FEWSHOT:
        msgs.append({"role": "user", "content": build_user_prompt(ex_text, work_title)})
        msgs.append({"role": "assistant", "content": json.dumps(ex_out, ensure_ascii=False)})
    msgs.append({"role": "user", "content": build_user_prompt(text, work_title, user_message)})
    return msgs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default=TEACHER_DEFAULT)
    ap.add_argument("--total", type=int, default=2400)
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--num-shards", type=int, default=1)
    ap.add_argument("--seed", type=int, default=20260915)
    ap.add_argument("--max-model-len", type=int, default=4096)
    ap.add_argument("--gpu-mem", type=float, default=0.90)
    args = ap.parse_args()

    from vllm import LLM, SamplingParams
    from transformers import AutoTokenizer

    work = load_work(args.work)
    rng = random.Random(args.seed)
    scenarios = [build_scenario(work, rng, i) for i in range(args.total)]
    mine = [s for i, s in enumerate(scenarios) if i % args.num_shards == args.shard]
    print(f"[shard {args.shard}] scenarios={len(mine)}", flush=True)

    tok = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    llm = LLM(
        model=args.model,
        max_model_len=args.max_model_len,
        gpu_memory_utilization=args.gpu_mem,
        trust_remote_code=True,
        enforce_eager=False,
    )

    def render(messages: list[dict]) -> str:
        try:
            return tok.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
            )
        except TypeError:  # thinking を持たないモデル
            return tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

    # --- stage A ---
    a_prompts = [
        render([{"role": "system", "content": STAGE_A_SYSTEM}, {"role": "user", "content": s["stage_a_prompt"]}])
        for s in mine
    ]
    a_params = SamplingParams(temperature=1.0, top_p=0.95, max_tokens=500, seed=None)
    a_out = llm.generate(a_prompts, a_params)

    dialogs = []
    for s, o in zip(mine, a_out):
        pair = parse_pair(o.outputs[0].text)
        if pair is None:
            continue
        user, shiori = pair
        dialogs.append({**s, "user_message": user, "text": shiori})
    print(f"[shard {args.shard}] stage A ok={len(dialogs)}/{len(mine)}", flush=True)

    # --- stage B ---
    b_prompts = [render(stage_b_messages(d["text"], d["work_title"], d["user_message"])) for d in dialogs]
    b_params = SamplingParams(temperature=0.0, top_p=1.0, max_tokens=1600)
    b_out = llm.generate(b_prompts, b_params)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        for d, o in zip(dialogs, b_out):
            row = {
                "id": d["id"],
                "work_title": d["work_title"],
                "kind": d["kind"],
                "length": d["length"],
                "claim_target": d["claim_target"],
                "want_negation": d["want_negation"],
                "want_lie": d["want_lie"],
                "user_message": d["user_message"],
                "text": d["text"],
                "label_raw": o.outputs[0].text,
            }
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"[shard {args.shard}] wrote {args.out}", flush=True)


if __name__ == "__main__":
    main()

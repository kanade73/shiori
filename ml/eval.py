"""ホールドアウトで claims 抽出の精度を測る。

比較する設定（--setup）:
  student-base   … 素の小型モデル（LoRA なし、zero-shot）
  student-lora   … LoRA を当てた小型モデル
  teacher-zero   … 教師モデルに student と同じ zero-shot プロンプトを与えたもの
  teacher-few    … 教師モデル + few-shot（教師データを作ったのと同じ設定。事実上の上限）

指標:
  json_parse   出力が {"claims":[...]} としてパースできた割合
  P/R/F1       三つ組 (subject, relation, object, negated) の完全一致（正規化後）micro
  set_exact    1件まるごと（claims 集合）が一致した割合
  quote_valid  出力した quote が返答文の literal な部分文字列だった割合

  python eval.py --data data/dataset/holdout.jsonl --setup student-lora \
      --model Qwen/Qwen3-1.7B --lora out/lora/adapter --out out/eval-student-lora.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    EXTRACT_PROMPT,
    build_user_prompt,
    parse_claims_json,
    read_jsonl,
    recover_quote,
    triple_key,
)
from synth import FEWSHOT  # noqa: E402


def messages_for(row: dict, few_shot: bool) -> list[dict]:
    msgs: list[dict] = [{"role": "system", "content": EXTRACT_PROMPT}]
    if few_shot:
        for ex_text, ex_out in FEWSHOT:
            msgs.append({"role": "user", "content": build_user_prompt(ex_text, row["work_title"])})
            msgs.append({"role": "assistant", "content": json.dumps(ex_out, ensure_ascii=False)})
    msgs.append(
        {"role": "user", "content": build_user_prompt(row["text"], row["work_title"], row.get("user_message") or None)}
    )
    return msgs


def object_matches(a: str, b: str) -> bool:
    """extract.ts の objectMatches と同じ基準。

    object は「なんとかバニアの魔女が特殊な方法で作ったもの」のような句なので、
    一字一句の一致を求めると言い回しの差だけで不正解になる。片方が他方を含んで
    いれば同じことを述べているとみなす（アプリ側の canon 照合と同じ扱い）。
    """
    if not a or not b:
        return False
    if a == b:
        return True
    if len(a) >= 2 and a in b:
        return True
    if len(b) >= 2 and b in a:
        return True
    return False


def pair_tp(gold: list[tuple], pred: list[tuple]) -> int:
    """object の言い回しを問わず、(subject, relation, negated) が合っていれば正解。

    「誰について・どの種類の主張を・肯定か否定か」を取りこぼしていないかを見る指標。
    object の表現ゆれと、主張の拾い漏れを切り分けるために置いている。
    """
    used = set()
    hit = 0
    for g in gold:
        for i, p in enumerate(pred):
            if i in used:
                continue
            if g[0] == p[0] and g[1] == p[1] and g[3] == p[3]:
                used.add(i)
                hit += 1
                break
    return hit


def relaxed_tp(gold: list[tuple], pred: list[tuple]) -> int:
    """subject と negated が一致し、relation が同じで object が包含関係なら正解。

    gold 1件につき pred 1件までの貪欲マッチ（同じ pred を二重に使わない）。
    """
    used = set()
    hit = 0
    for g in gold:
        for i, p in enumerate(pred):
            if i in used:
                continue
            if g[0] == p[0] and g[1] == p[1] and g[3] == p[3] and object_matches(g[2], p[2]):
                used.add(i)
                hit += 1
                break
    return hit


def _prf(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    return precision, recall, 2 * precision * recall / max(1e-9, precision + recall)


def score(rows: list[dict], preds: list[str]) -> dict:
    tp = fp = fn = 0
    rtp = rfp = rfn = 0
    ptp = pfp = pfn = 0
    parsed_ok = 0
    set_exact = 0
    quote_total = quote_ok = 0
    for row, raw in zip(rows, preds):
        gold_list = [triple_key(c) for c in row["claims"]]
        gold = set(gold_list)
        claims = parse_claims_json(raw)
        if claims is None:
            fn += len(gold)
            rfn += len(gold_list)
            pfn += len(gold_list)
            continue
        parsed_ok += 1
        pred_list = []
        for c in claims:
            if not isinstance(c, dict):
                continue
            pred_list.append(triple_key(c))
            q = str(c.get("quote", "") or "")
            if q:
                quote_total += 1
                quote_ok += 1 if recover_quote(q, row["text"]) is not None else 0
        pred = set(pred_list)
        tp += len(gold & pred)
        fp += len(pred - gold)
        fn += len(gold - pred)
        set_exact += 1 if gold == pred else 0
        hit = relaxed_tp(gold_list, pred_list)
        rtp += hit
        rfp += len(pred_list) - hit
        rfn += len(gold_list) - hit
        phit = pair_tp(gold_list, pred_list)
        ptp += phit
        pfp += len(pred_list) - phit
        pfn += len(gold_list) - phit
    n = max(1, len(rows))
    precision, recall, f1 = _prf(tp, fp, fn)
    rp, rr, rf1 = _prf(rtp, rfp, rfn)
    _, _, pf1 = _prf(ptp, pfp, pfn)
    return {
        "n": len(rows),
        "json_parse": parsed_ok / n,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "relaxed_precision": rp,
        "relaxed_recall": rr,
        "relaxed_f1": rf1,
        "pair_f1": pf1,
        "set_exact": set_exact / n,
        "quote_valid": (quote_ok / quote_total) if quote_total else None,
        "tp": tp,
        "fp": fp,
        "fn": fn,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--setup", required=True, choices=["student-base", "student-lora", "teacher-zero", "teacher-few"])
    ap.add_argument("--model", required=True)
    ap.add_argument("--rescore", default=None, help="生成済みの .preds.jsonl を読み直して指標だけ計算する")
    ap.add_argument("--lora", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-model-len", type=int, default=4096)
    ap.add_argument("--gpu-mem", type=float, default=0.88)
    ap.add_argument("--max-tokens", type=int, default=1600)
    args = ap.parse_args()

    rows = read_jsonl(args.data)

    if args.rescore:
        # モデルを立てずに、保存済みの生出力から指標だけ計算し直す
        saved = read_jsonl(args.rescore)
        by_id = {r["id"]: r for r in saved}
        rows = [r for r in rows if r["id"] in by_id]
        result = score(rows, [by_id[r["id"]]["pred_raw"] for r in rows])
        result.update(setup=args.setup, model=args.model, lora=args.lora, rescored_from=args.rescore)
        # 生成時に測ったスループットは preds には入っていないので、元の eval json から引き継ぐ
        origin = args.rescore.replace(".preds.jsonl", ".json")
        if os.path.exists(origin):
            with open(origin, encoding="utf-8") as f:
                prev = json.load(f)
            for k in ("batched_seconds", "batched_per_item_ms"):
                if k in prev:
                    result[k] = prev[k]
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    from transformers import AutoTokenizer
    from vllm import LLM, SamplingParams

    tok = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    few = args.setup == "teacher-few"

    def render(msgs):
        try:
            return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        except TypeError:
            return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)

    prompts = [render(messages_for(r, few)) for r in rows]

    llm_kwargs = dict(
        model=args.model,
        max_model_len=args.max_model_len,
        gpu_memory_utilization=args.gpu_mem,
        trust_remote_code=True,
    )
    lora_request = None
    if args.setup == "student-lora":
        if not args.lora:
            raise SystemExit("--lora is required for student-lora")
        from vllm.lora.request import LoRARequest

        llm_kwargs.update(enable_lora=True, max_lora_rank=64)
        lora_request = LoRARequest("extractor", 1, args.lora)

    llm = LLM(**llm_kwargs)
    params = SamplingParams(temperature=0.0, top_p=1.0, max_tokens=args.max_tokens)
    t0 = time.time()
    outs = llm.generate(prompts, params, lora_request=lora_request) if lora_request else llm.generate(prompts, params)
    elapsed = time.time() - t0
    preds = [o.outputs[0].text for o in outs]

    result = score(rows, preds)
    result["setup"] = args.setup
    result["model"] = args.model
    result["lora"] = args.lora
    result["batched_seconds"] = elapsed
    result["batched_per_item_ms"] = elapsed / max(1, len(rows)) * 1000

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    with open(args.out.replace(".json", ".preds.jsonl"), "w", encoding="utf-8") as f:
        for r, p in zip(rows, preds):
            f.write(json.dumps({"id": r["id"], "text": r["text"], "gold": r["claims"], "pred_raw": p}, ensure_ascii=False) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

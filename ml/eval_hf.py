"""serve.py と同じ transformers 経路でホールドアウトを流し、予測とレイテンシを出す。

用途は2つ。
  1. 1件あたりのレイテンシ計測（本番の serve.py とまったく同じ経路で測る）
  2. vLLM の LoRA 適用が正しいかの突き合わせ。eval.py（vLLM）と結果が大きく違えば、
     モデルではなく推論側を疑う

出力した `*.preds.jsonl` は `eval.py --rescore` でそのまま採点できる。

  python eval_hf.py --data data/dataset/holdout.jsonl --lora out/lora/adapter \
      --device cuda:0 -n 100 --out out/eval-hf-student-lora.preds.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import serve  # noqa: E402
from common import read_jsonl  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default="Qwen/Qwen3-1.7B")
    ap.add_argument("--lora", default=None)
    ap.add_argument("--device", default="cuda:0")
    ap.add_argument("--dtype", default="bfloat16", choices=["bfloat16", "float16", "float32"])
    ap.add_argument("-n", type=int, default=100)
    ap.add_argument("--out", required=True)
    ap.add_argument("--latency-out", default=None)
    args = ap.parse_args()

    if args.device.startswith("cpu") and args.dtype == "bfloat16":
        args.dtype = "float32"
    rows = read_jsonl(args.data)[: args.n]

    t0 = time.time()
    serve.load(args.model, args.lora, args.device, args.dtype)
    load_s = time.time() - t0
    print(f"loaded in {load_s:.1f}s", flush=True)

    # 1回ウォームアップしてから測る（初回は CUDA カーネルの準備が乗る）
    serve.extract(rows[0]["text"], rows[0]["work_title"], rows[0].get("user_message"))

    times: list[float] = []
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        for i, r in enumerate(rows):
            t = time.time()
            _, raw = serve.extract(r["text"], r["work_title"], r.get("user_message"))
            times.append((time.time() - t) * 1000)
            f.write(
                json.dumps({"id": r["id"], "text": r["text"], "gold": r["claims"], "pred_raw": raw}, ensure_ascii=False)
                + "\n"
            )
            if (i + 1) % 10 == 0:
                print(f"{i + 1}/{len(rows)} median={statistics.median(times):.0f}ms", flush=True)

    lat = {
        "model": args.model,
        "lora": args.lora,
        "device": args.device,
        "dtype": args.dtype,
        "n": len(times),
        "load_seconds": round(load_s, 1),
        "mean_ms": round(statistics.mean(times), 1),
        "median_ms": round(statistics.median(times), 1),
        "p90_ms": round(sorted(times)[max(0, int(len(times) * 0.9) - 1)], 1),
        "min_ms": round(min(times), 1),
        "max_ms": round(max(times), 1),
    }
    print(json.dumps(lat, ensure_ascii=False, indent=2))
    if args.latency_out:
        with open(args.latency_out, "w", encoding="utf-8") as f:
            json.dump(lat, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()

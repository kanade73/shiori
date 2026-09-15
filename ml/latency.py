"""1件あたりの推論レイテンシを測る（serve.py と同じ transformers 経路で）。

  python latency.py --model Qwen/Qwen3-1.7B --lora out/lora/adapter --device cuda:0 -n 20
  python latency.py --model Qwen/Qwen3-1.7B --lora out/lora/adapter --device cpu   -n 5
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
    ap.add_argument("--model", default="Qwen/Qwen3-1.7B")
    ap.add_argument("--lora", default=None)
    ap.add_argument("--device", default="cuda:0")
    ap.add_argument("--dtype", default="bfloat16", choices=["bfloat16", "float16", "float32"])
    ap.add_argument("--data", required=True)
    ap.add_argument("-n", type=int, default=20)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    if args.device.startswith("cpu") and args.dtype == "bfloat16":
        args.dtype = "float32"
    rows = read_jsonl(args.data)[: args.n]
    t_load = time.time()
    serve.load(args.model, args.lora, args.device, args.dtype)
    load_s = time.time() - t_load

    # 1回ウォームアップしてから測る
    serve.extract(rows[0]["text"], rows[0]["work_title"], rows[0].get("user_message"))
    times, out_chars = [], []
    for r in rows:
        t0 = time.time()
        claims, raw = serve.extract(r["text"], r["work_title"], r.get("user_message"))
        times.append((time.time() - t0) * 1000)
        out_chars.append(len(raw))

    result = {
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
        "mean_output_chars": round(statistics.mean(out_chars), 1),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()

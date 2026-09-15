"""評価結果の JSON をまとめて 1 枚の表にする。

  python summarize.py $SCRATCH/out/eval-*.json
  python summarize.py --rescore $SCRATCH/out   # preds を読み直して緩い一致も含めて出す
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ORDER = ["student-base", "teacher-zero", "student-lora", "teacher-few"]
LABEL = {
    "student-base": "student 素 (Qwen3-1.7B, zero-shot)",
    "teacher-zero": "teacher zero-shot (Qwen3-14B-AWQ)",
    "student-lora": "**student + LoRA (Qwen3-1.7B)**",
    "teacher-few": "teacher few-shot（ラベル生成と同条件＝上限）",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*")
    ap.add_argument("--markdown", action="store_true")
    args = ap.parse_args()

    files = args.files or sorted(glob.glob("out/eval-*.json"))
    results = []
    for f in files:
        with open(f, encoding="utf-8") as fh:
            d = json.load(fh)
        d["_file"] = f
        results.append(d)
    results.sort(key=lambda d: ORDER.index(d["setup"]) if d["setup"] in ORDER else 99)

    header = "| 設定 | JSONパース率 | 厳密F1 | 緩いF1 | 主語+関係F1 | 完全一致 | quote有効率 | バッチ推論 ms/件 |"
    sep = "|---|---|---|---|---|---|---|---|"
    print(header)
    print(sep)
    for d in results:
        q = d.get("quote_valid")
        print(
            f"| {LABEL.get(d['setup'], d['setup'])} "
            f"| {d['json_parse']:.2f} "
            f"| {d['f1']:.3f} "
            f"| {d.get('relaxed_f1', float('nan')):.3f} "
            f"| {d.get('pair_f1', float('nan')):.3f} "
            f"| {d['set_exact']:.2f} "
            f"| {'-' if q is None else f'{q:.2f}'} "
            f"| {d.get('batched_per_item_ms', float('nan')):.0f} |"
        )


if __name__ == "__main__":
    main()

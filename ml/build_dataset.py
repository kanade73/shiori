"""合成したシャードを検証して学習用データセットに固める。

捨てる条件（common.clean_claims と同じ基準）:
  - label の JSON がパースできない
  - relation が閉じた語彙の外 / subject・object が空
  - quote が返答文から復元できない（要約された quote は使えない）
  - 返答文が重複している

さらに、claim_target > 0 なのに claims が空になった行は「教師が取りこぼした」
可能性が高いので落とす（逆に claim_target == 0 で空なのは正解なので残す）。

  python build_dataset.py --in data/synth --out data/dataset --holdout 100
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import random
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import clean_claims, parse_claims_json, write_jsonl  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True, help="シャードの入ったディレクトリ")
    ap.add_argument("--out", required=True)
    ap.add_argument("--holdout", type=int, default=100)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.inp, "*.jsonl")))
    raw: list[dict] = []
    for p in files:
        with open(p, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    raw.append(json.loads(line))
    print(f"raw rows: {len(raw)} from {len(files)} shards")

    stats = Counter()
    seen_text: set[str] = set()
    rows: list[dict] = []
    for r in raw:
        text = (r.get("text") or "").strip()
        if not text:
            stats["empty_text"] += 1
            continue
        if text in seen_text:
            stats["dup_text"] += 1
            continue
        claims = parse_claims_json(r.get("label_raw") or "")
        if claims is None:
            stats["bad_json"] += 1
            continue
        cleaned, dropped = clean_claims(claims, text, require_quote=True)
        stats["dropped_claims"] += dropped
        if dropped and not cleaned:
            stats["all_claims_dropped"] += 1
            continue
        if r.get("claim_target", 0) > 0 and not cleaned:
            stats["empty_but_expected"] += 1
            continue
        seen_text.add(text)
        rows.append(
            {
                "id": r["id"],
                "work_title": r["work_title"],
                "kind": r.get("kind"),
                "user_message": r.get("user_message") or "",
                "text": text,
                "claims": cleaned,
            }
        )
        stats["kept"] += 1
        stats["kept_empty_claims"] += 1 if not cleaned else 0

    rng = random.Random(args.seed)
    rng.shuffle(rows)
    holdout = rows[: args.holdout]
    train = rows[args.holdout :]

    os.makedirs(args.out, exist_ok=True)
    write_jsonl(os.path.join(args.out, "train.jsonl"), train)
    write_jsonl(os.path.join(args.out, "holdout.jsonl"), holdout)

    n_claims = sum(len(r["claims"]) for r in rows)
    print(json.dumps(dict(stats), ensure_ascii=False, indent=2))
    print(f"train={len(train)} holdout={len(holdout)} total_claims={n_claims} avg={n_claims/max(1,len(rows)):.2f}")


if __name__ == "__main__":
    main()

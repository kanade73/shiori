#!/bin/bash
# 教師データ合成を GPU の枚数だけデータ並列で回す。
# 1 GPU = 1 プロセス = 1 シャード。全部終わるまで待つ。
#   ./run_synth.sh <総件数> <シャード数> <出力ディレクトリ>
set -eu
source "$HOME/chat-lora/env.sh"

TOTAL=${1:-2400}
SHARDS=${2:-8}
OUTDIR=${3:-$SCRATCH/data/synth}
MODEL=${TEACHER_MODEL:-Qwen/Qwen3-14B-AWQ}

mkdir -p "$OUTDIR" "$ML/logs"
pids=()
for i in $(seq 0 $((SHARDS - 1))); do
  CUDA_VISIBLE_DEVICES=$i "$VLLM_PY" "$ML/synth.py" \
    --work "$ML/work.json" \
    --out "$OUTDIR/shard$i.jsonl" \
    --model "$MODEL" \
    --total "$TOTAL" --shard "$i" --num-shards "$SHARDS" \
    > "$ML/logs/synth_$i.log" 2>&1 &
  pids+=($!)
  sleep 4   # HF キャッシュへの同時書き込みを少しずらす
done

fail=0
for p in "${pids[@]}"; do
  wait "$p" || fail=1
done
echo "SYNTH_DONE fail=$fail rows=$(cat "$OUTDIR"/*.jsonl 2>/dev/null | wc -l)"

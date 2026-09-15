#!/bin/bash
# 合成 → データセット化 → LoRA 学習 → 評価 を一本で流す。
# tmux の中で回す想定（ssh が切れても続くように）:
#   tmux new-session -d -s pipeline "bash ~/chat-lora/run_all.sh 2400 8 > ~/chat-lora/logs/pipeline.log 2>&1"
set -eux
source "$HOME/chat-lora/env.sh"
# 進捗をログにすぐ出す（リダイレクト先ではブロックバッファになり、
# 学習中まったく何も出ないので止まったのか進んでいるのか分からなくなる）
export PYTHONUNBUFFERED=1

TOTAL=${1:-2400}
SHARDS=${2:-8}
EPOCHS=${3:-2}
SYNTH_DIR=$SCRATCH/data/synth
DS_DIR=$SCRATCH/data/dataset
RUN_DIR=$SCRATCH/out/lora
STUDENT=${STUDENT_MODEL:-Qwen/Qwen3-1.7B}

bash "$ML/run_synth.sh" "$TOTAL" "$SHARDS" "$SYNTH_DIR"

"$TRAIN_PY" "$ML/build_dataset.py" --in "$SYNTH_DIR" --out "$DS_DIR" --holdout 100

CUDA_VISIBLE_DEVICES=0 "$TRAIN_PY" "$ML/train_lora.py" \
  --data "$DS_DIR/train.jsonl" --out "$RUN_DIR" \
  --model "$STUDENT" --epochs "$EPOCHS" --batch 2 --accum 32 --grad-ckpt 1 --max-len 1664 --merge

for setup in student-base student-lora teacher-zero teacher-few; do
  case $setup in
    student-*) MODEL=$STUDENT ;;
    teacher-*) MODEL=${TEACHER_MODEL:-Qwen/Qwen3-14B-AWQ} ;;
  esac
  LORA_ARG=""
  [ "$setup" = "student-lora" ] && LORA_ARG="--lora $RUN_DIR/adapter"
  CUDA_VISIBLE_DEVICES=0 "$VLLM_PY" "$ML/eval.py" \
    --data "$DS_DIR/holdout.jsonl" --setup "$setup" --model "$MODEL" $LORA_ARG \
    --out "$SCRATCH/out/eval-$setup.json"
done

echo PIPELINE_DONE

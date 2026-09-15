#!/bin/bash
# 4 設定を順に評価する（vLLM を1つずつ立てるので直列）。
#   tmux new-session -d -s eval "bash ~/chat-lora/run_eval.sh > ~/chat-lora/logs/eval.log 2>&1"
set -eux
source "$HOME/chat-lora/env.sh"
export PYTHONUNBUFFERED=1

DS=${DS:-$SCRATCH/data/dataset}
RUN_DIR=${RUN_DIR:-$SCRATCH/out/lora}
STUDENT=${STUDENT_MODEL:-Qwen/Qwen3-1.7B}
TEACHER=${TEACHER_MODEL:-Qwen/Qwen3-14B-AWQ}
GPU=${GPU:-0}

for setup in student-base student-lora teacher-zero teacher-few; do
  case $setup in
    student-*) MODEL=$STUDENT ;;
    teacher-*) MODEL=$TEACHER ;;
  esac
  LORA_ARG=""
  [ "$setup" = "student-lora" ] && LORA_ARG="--lora $RUN_DIR/adapter"
  CUDA_VISIBLE_DEVICES=$GPU "$VLLM_PY" "$ML/eval.py" \
    --data "$DS/holdout.jsonl" --setup "$setup" --model "$MODEL" $LORA_ARG \
    --out "$SCRATCH/out/eval-$setup.json"
done
echo EVAL_DONE

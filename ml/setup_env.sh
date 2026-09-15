#!/bin/bash
# GPU サーバ（gpu04）に venv を2つ作る。~/chat-lora/env.sh を先に置いておくこと。
#   bash setup_env.sh
#
# venv を分けているのは、vLLM が transformers のバージョンを強く縛るため
# （5.x を入れると vLLM 0.11 が Qwen2Tokenizer で落ちる）。
# Python は uv 管理のものを使う。システム Python には Python.h が無く、
# triton の JIT が cuda_utils.c をコンパイルできずに vLLM が起動しない。
set -ex
source "$HOME/chat-lora/env.sh"
UV="$HOME/.local/bin/uv"

$UV python install 3.11
PY311=$($UV python find 3.11)

# 合成・評価・推論（vLLM）。vllm は CUDA 12.8 ビルドの 0.11.0 に固定する。
# 素の `uv pip install vllm` は torch cu130 を引き、driver 570 では起動しない。
$UV venv "$SCRATCH/venv-vllm" --python "$PY311"
$UV pip install --python "$VLLM_PY" "vllm==0.11.0" "transformers==4.56.2" fastapi uvicorn

# 学習（と transformers バックエンドの推論）
$UV venv "$SCRATCH/venv-train" --python "$PY311"
$UV pip install --python "$TRAIN_PY" torch --index-url https://download.pytorch.org/whl/cu128
$UV pip install --python "$TRAIN_PY" \
  "transformers==4.56.2" "peft==0.17.1" "trl==0.21.0" "accelerate>=1.6" datasets fastapi uvicorn

"$VLLM_PY" -c "import vllm, torch; print('vllm', vllm.__version__, torch.__version__)"
"$TRAIN_PY" -c "import torch, transformers, peft; print('train', torch.__version__, transformers.__version__, peft.__version__)"
echo SETUP_DONE

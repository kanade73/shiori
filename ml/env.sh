# GPU サーバ用の共通パス。長い処理の前に `source ~/chat-lora/env.sh` する。
# 重いものはホーム（quota あり）ではなくローカルディスクに置く
export SCRATCH=/var/tmp/$USER/chat-lora   # 例: /var/tmp/h2511188/chat-lora
export UV_CACHE_DIR="$SCRATCH/.uvcache"
export HF_HOME="$SCRATCH/.hf"
export HF_HUB_ENABLE_HF_TRANSFER=0
export VLLM_PY="$SCRATCH/venv-vllm/bin/python"
export TRAIN_PY="$SCRATCH/venv-train/bin/python"
export ML=$HOME/chat-lora
export TOKENIZERS_PARALLELISM=false
mkdir -p "$SCRATCH" "$UV_CACHE_DIR" "$HF_HOME" "$ML/logs" "$SCRATCH/data" "$SCRATCH/out"

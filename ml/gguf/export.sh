#!/usr/bin/env bash
# マージ済みの抽出モデル（HF 形式）→ GGUF（Q8_0）→ Ollama に登録 → （任意）Hugging Face に上げる。
# Mac で実行する想定。GPU サーバから merged/ を rsync してから使う。
#
#   brew install llama.cpp                # llama-quantize
#   python3 -m venv venv && venv/bin/pip install -r llama.cpp/requirements/requirements-convert_hf_to_gguf.txt
#   ./export.sh <merged のディレクトリ> [HF のリポジトリ名 例 kanade73/shiori-extract-1.7b-gguf]
set -euo pipefail
MERGED=${1:?merged のディレクトリ}
HF_REPO=${2:-}
NAME=shiori-extract-1.7b
HERE=$(cd "$(dirname "$0")" && pwd)
LLAMA_CPP=${LLAMA_CPP:-$HERE/llama.cpp}
PY=${PY:-$HERE/venv/bin/python}

[ -d "$LLAMA_CPP" ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$LLAMA_CPP"
"$PY" "$LLAMA_CPP/convert_hf_to_gguf.py" "$MERGED" --outfile "$HERE/$NAME-f16.gguf" --outtype f16
llama-quantize "$HERE/$NAME-f16.gguf" "$HERE/$NAME-q8_0.gguf" Q8_0
(cd "$HERE" && ollama create shiori-extract -f Modelfile)
echo "ollama に shiori-extract を登録した。.env.local: EXTRACT_OLLAMA_MODEL=shiori-extract"

if [ -n "$HF_REPO" ]; then
  # 事前に `hf auth login`。公開リポジトリにすると相方は `ollama pull hf.co/$HF_REPO:Q8_0` だけで使える
  hf repo create "$HF_REPO" --type model -y || true
  hf upload "$HF_REPO" "$HERE/$NAME-q8_0.gguf" "$NAME-Q8_0.gguf"
  hf upload "$HF_REPO" "$HERE/README.hf.md" README.md
  echo "相方: ollama pull hf.co/$HF_REPO:Q8_0 && EXTRACT_OLLAMA_MODEL=hf.co/$HF_REPO:Q8_0"
fi

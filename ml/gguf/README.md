# 抽出モデルを Mac の Ollama で動かす（GGUF）

GPU サーバの推論サーバ（`serve.py`）に頼らず、手元の Ollama で LoRA 抽出モデル
（Qwen3-1.7B マージ済み）を動かすための一式。Mac（Apple Silicon）で 1 発話 2 秒前後。

| もの | 用途 |
|---|---|
| `export.sh` | merged/ → GGUF(F16) → Q8_0（1.7GB）→ `ollama create shiori-extract` →（任意）Hugging Face に upload |
| `Modelfile` | Ollama への登録（temperature 0, num_ctx 4096。チャットテンプレートは GGUF の中のものを使う） |
| `README.hf.md` | Hugging Face 側のモデルカード |

## 相方（使う側）

Hugging Face に上がっていれば、モデルを作り直す必要は無い。

```bash
brew install ollama && ollama serve &          # 入っていなければ
ollama pull hf.co/<HF のリポジトリ>:Q8_0
echo 'EXTRACT_OLLAMA_MODEL=hf.co/<HF のリポジトリ>:Q8_0' >> .env.local
```

`EXTRACT_ENDPOINT` と SSH トンネルは要らない。開発者パネルの extract 段に `backend: ollama` と出れば動いている。

## 作る側（GGUF を作り直すとき）

```bash
rsync -a h2511188@gpu04.ced.cei.uec.ac.jp:/var/tmp/h2511188/chat-lora/out/lora/merged/ merged/
brew install llama.cpp
git clone --depth 1 https://github.com/ggml-org/llama.cpp.git
python3 -m venv venv && venv/bin/pip install -r llama.cpp/requirements/requirements-convert_hf_to_gguf.txt
hf auth login                                   # 上げるなら
./export.sh merged kanade73/shiori-extract-1.7b-gguf
```

## 注意

- Ollama の `format` に **JSON schema を渡すと三つ組が崩れる**（object に subject が写った）。`extract.ts` は `format: "json"` で呼ぶ
- 量子化は Q8_0。もっと軽くするなら `llama-quantize ... Q4_K_M`（約 1GB）だが精度は測っていない
- 生成物（`*.gguf`・`merged/`・`llama.cpp/`・`venv/`）はコミットしない（`ml/.gitignore`）

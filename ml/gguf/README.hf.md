---
base_model: Qwen/Qwen3-1.7B
language: [ja]
license: apache-2.0
tags: [gguf, ollama, qwen3, lora, information-extraction]
---

# shiori-extract-1.7b (GGUF, Q8_0)

Qwen3-1.7B に LoRA を当ててマージした、日本語のアニメ考察チャットの返答文から
設定上の主張（subject / relation / object / negated / claim / quote）を JSON で取り出すモデル。
[misdirection-chat](https://github.com/kanade73/hackathon) の claims 抽出用。

```bash
ollama pull hf.co/<this repo>:Q8_0
```

`format: "json"`・`think: false`・temperature 0 で使う。JSON schema の制約付き生成は出力を崩すので使わない。

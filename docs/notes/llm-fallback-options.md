# Gemini の枠が尽きたときの逃げ先（調査メモ・2026-09-16）

**コードは変えていない。何を選ぶかを決めるための材料だけ。**

Gemini の無料枠（モデルごと・プロジェクトごと）が尽きたときや、混雑（503）で返らないときに、別の無料枠へ逃がせるかを調べた。数字は各社のブログ・まとめサイト経由のものが多く、**実際の枠は各コンソールで確認すること**（Groq も Cerebras も「正確な値はアカウントの limits ページ」と書いている）。

## 前提: この app の4つの呼び出し口

逃げ先は1つに決めなくていい。呼び出し口ごとに要る性質が違う。

| 呼び出し | 頻度 | 要るもの | 日本語の質 |
|---|---|---|---|
| シオリの返答（generate） | 毎発話1回（差し戻しで2回） | 素のテキスト | **これが体験そのもの。妥協できない** |
| としおの割り込み | 割り込む回だけ | 構造化出力（zod スキーマ） | 高い方がよい |
| 資料係（topic） | 話題を調べる回だけ | 構造化出力 + 日本語の資料を読む | 中。事実を抜くだけ |
| 主張の取り出し（extract） | 毎発話1回 | **JSON schema の構造化出力**。出力は三つ組で短い | 低くてよい |
| 話題の切り替わりの判定役（router） | ゲートを通った回だけ | 構造化出力・小さい文脈 | 低くてよい |
| 段落の埋め込み | 話題を調べる回 + 初回の一括 | 埋め込み | — |

**extract は手元の Ollama / LoRA サーバに向けられる（実装済み）。ここは無料枠を1つも使わずに逃がせる。** 逃げ先が要るのは主に generate・としお・資料係・埋め込み。

## 候補（無料枠があるもの）

すべて OpenAI 互換のエンドポイントを持つので、差し替えは「base URL とモデル名を変える」程度で済む（`@google/genai` ではなく OpenAI SDK か素の fetch になる）。

| 提供元 | 無料枠（目安） | モデル | 構造化出力 | 備考 |
|---|---|---|---|---|
| **Groq** | 30 req/分・14,400 req/日（組織ごと・モデルごと。トークンは 6K〜30K/分） | gpt-oss 20B/120B、Llama 3.3 70B、Qwen3、Kimi K2 ほか | **JSON schema の strict モードあり**（gpt-oss 20B/120B と qwen3 系）。streaming と併用不可 | 速い。**キーを増やしても枠は増えない**（組織単位） |
| **Cerebras** | 1M トークン/日、30 req/分、14,400 req/日。**文脈は 8,192 トークンに制限** | Llama 3.3 70B、Qwen3 235B ほか | OpenAI 互換（json_schema は要確認） | 非常に速い。文脈の上限がこの app には効く場面あり（資料係に段落8件を渡すと超えうる） |
| **Cloudflare Workers AI** | 10,000 neurons/日（モデルごとの換算。小さいモデルなら数十万トークン相当） | Llama、Qwen3 30B MoE、Kimi K2 系 ほか | モデル依存 | 日本語の評判が良いモデルを含む。Workers の外からも API トークンで叩ける（要確認） |
| **Mistral（La Plateforme の Experiment）** | 公表値なし（1 req/秒・月1B トークンという記述）。コンソールで確認 | Mistral Small / Large、埋め込みも | OpenAI 互換 | 評価用。本番利用は想定外と明記 |
| **GitHub Models** | 10〜15 req/分、50〜150 req/日（プラン依存）。入力 8K・出力 4K | GPT-4o / 4o-mini、Llama、DeepSeek | OpenAI 互換 | **規約が「試作・実験のみ」。ユーザーに使わせるのは規約違反** |
| **OpenRouter（`:free` のモデル）** | 20 req/分・**50 req/日**（$10 課金で 1,000/日） | 25〜28 前後の無料モデル（流動的） | モデル依存 | 無料枠は日 50 回。デモ1回分には足りるが心もとない |
| **NVIDIA build（NIM）** | 40 req/分、クレジット制（1,000 程度） | 100+（DeepSeek、Qwen、Llama、Nemotron） | OpenAI 互換 | クレジットを使い切ると終わり |
| **Zhipu（GLM-4.x-Flash）** | 公表値なし | GLM-4.7-Flash ほか | OpenAI 互換 | 中国語圏のモデル。日本語は要確認 |
| **Cohere（トライアルキー）** | 20 req/分・1,000 req/月 | Command A / R+、**埋め込み・リランクも** | 部分的に互換 | 月1,000回は少ない |

### 埋め込み（段落のベクトル検索の逃げ先）

| 提供元 | 無料枠 | 備考 |
|---|---|---|
| Jina Embeddings v4 | 1M トークン/月 | 32K 文脈 |
| Voyage AI | 200M トークン（voyage-4 系） | 枠は大きい |
| Cohere embed-v4 | トライアルキーの 1,000 req/月に含む | |
| Mistral embed | Experiment 枠の中 | |
| **手元の埋め込み（Ollama の nomic-embed-text など）** | 無制限 | 次元が変わるのでベクトルDBのファイルは作り直し（`DATA_DIR/vectors/<モデル>-<次元>.sqlite` と、モデル名で分かれる作りにはなっている） |

## この app に当てはめたときの見立て

1. **extract は Ollama に向けるのが一番安い**（実装済み・枠を使わない）。`EXTRACT_OLLAMA_MODEL` を設定するだけ。いま 3.1-flash-lite の 503 で主張が0件になっているのは、これで消える
2. **router（判定役）と資料係の逃げ先は Groq が有力**。構造化出力が JSON schema の strict モードで保証され、枠も日 14,400 回と大きい。文脈も 131K あるので資料係の段落8件が入る
3. **シオリの返答（generate）の逃げ先は慎重に**。口調と日本語の自然さがそのまま体験になる。候補は Cloudflare の Kimi K2 系か Qwen3 系、Groq の Kimi K2。**採用するなら同じプロンプトで実際に喋らせて比べること**（ベンチマークではなく口調で選ぶ）
4. **Cerebras は文脈 8K の制限に注意**。シオリのプロンプト（約2K）なら入るが、資料係には向かない場面がある
5. **GitHub Models は規約上、提出物のデモに使わない方がよい**（試作・実験のみ）

## 実装するとしたら（見積もりだけ。今回は書いていない）

- いまの `lib/server/llm/client.ts` は `@google/genai` の `ai.models.generateContent` / `embedContent` を key-pool で包んだもの。**逃げ先を足すなら、この `ai` と同じ形の口を OpenAI 互換の fetch で実装し、key-pool の「休ませる」仕組みの外側で「Gemini が全部休み中なら別提供元へ」を足す**のが素直
- 構造化出力の指定が提供元ごとに違う（Gemini は `responseSchema`、OpenAI 互換は `response_format.json_schema`）。呼び出し側4か所（generate 以外）が zod / Type のスキーマを渡しているので、スキーマを1つの形から両方へ変換する層が要る
- 難しさの順は **extract（済み）< router < 資料係 < としお < generate**。口調の検証が要るのは generate と としお

## 出どころ

- [Groq: Rate Limits](https://console.groq.com/docs/rate-limits) / [Structured Outputs](https://console.groq.com/docs/structured-outputs) / [Models](https://console.groq.com/docs/models)
- [Groq Free Tier Limits 2026（まとめ）](https://tokenmix.ai/blog/groq-free-tier-limits-2026)
- [Cerebras Free Tier 2026（まとめ）](https://www.getaiperks.com/en/ai/cerebras-free-tier-guide) / [Cerebras pricing](https://www.cerebras.ai/pricing)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Mistral 無料枠（まとめ）](https://costbench.com/software/llm-api-providers/mistral-ai/free-plan/)
- [OpenRouter の無料モデル（まとめ）](https://klymentiev.com/blog/openrouter-free-tier)
- [GitHub Models の無料枠（まとめ）](https://free-llm-apis.pages.dev/providers/github-models/)
- [NVIDIA build（NIM）の無料枠（まとめ）](https://yangmao.ai/en/providers/nvidia-build/)
- [awesome-free-llm-apis（一覧）](https://github.com/amardeeplakshkar/awesome-free-llm-apis)
- [無料LLM API一覧@10社以上(2026)（日本語）](https://note.com/gadget_hack/n/nd391c04bc338)
- [日本語対応 LLM ランキング2026](https://blog.qualiteg.com/llm-ranking-2026/)

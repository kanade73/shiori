# そんなシーンあった？ — misdirection-chat

「本当らしい嘘」を刷り込んで、見慣れたアニメを少しだけ初見に戻すチャットアプリ。

ハックツハッカソン（テーマ「時」）提出作品。

## コンセプト

「あの作品を、もう一度初めて見たい」。時間は巻き戻せないので、代わりに**記憶の側をミスディレクションします**。

2周目を見る前に、キャラクター「シオリ」とその作品について語り合うと、シオリは本物の設定の中に小さな嘘を混ぜて話します。「あの場面で、最後まで一度も座らなかったよね」のような、見返せば確かめたくなる細部の嘘です。会話のあとに実際に見返すと「そんなシーンあった？」となり、既知の作品が少しだけ未知に戻ります。最後には答え合わせ画面で、どこが本当でどこが嘘だったかを明かします。

体験の芯:

- **事実は正確に、嘘は小さく**。事実が雑だと嘘が成立しない
- **一度ついた嘘はセッション内で一貫する**。矛盾する嘘はコードで検出して再生成する
- **キャラは嘘を認めない**。種明かしはキャラの口からではなく、アプリの外側（答え合わせ画面）で行う

## 主な機能

- 作品を選び、シオリと感想を語り合う（SSE によるストリーミング応答）
- 話数は聞かない。最初の発言から話している場面を Wikipedia の記事で特定し、その場面の事実に嘘を混ぜて返す
- 話題の切り替わり（「そういえば〜」）を検知して場面を引き直す
- 2人目のキャラ「としお」が、シオリの嘘を前提にした「深い考察」で割り込む
- 会話の終わりに答え合わせ（本当か嘘かを予想 → 真偽つきで会話を振り返る）
- 開発者向け管理画面（本物の設定と生成された嘘を並べて見る）

現在の対応作品は『ちいかわ』。`data/` にディレクトリを足せば作品を増やせます。

## 仕組み

1発話ごとに次のパイプラインを回します（`lib/server/llm/pipeline.ts`）。

1. **話題の特定（RAG）** — MediaWiki API で記事を取得して段落に分け、文字 bigram とベクトル検索（Gemini Embedding + sqlite-vec）の2本立てで場面を探す。資料係（Gemini）が場面の名前と事実を資料に書かれたことだけから抜く
2. **analyze** — 発話から言及キャラ・出来事・質問種別を抽出（LLM は使わず、別名の文字列一致と正規表現）
3. **retrieve** — 視聴済み範囲の本物の設定（`canonFacts`）と、セッション内の既存の嘘を集める
4. **generate** — シオリが返答文と、その中で述べた「設定上の主張」（主語・関係・目的語 + 本物 / 作り話の印）を構造化出力で返す
5. **evaluate** — 既存の嘘との矛盾、本物の設定の上書き、未視聴範囲への依拠を決定的なルールで検査。矛盾があれば理由を付けて1回だけ再生成
6. **としお割り込み** — シオリの返答を流し切った後、作り手の作風とランダムに選んだ「切り口」を土台に考察を重ねる

作り話の主張は正規化して保存し、以後の会話の材料に含めます。これが「矛盾しない嘘」の実体です。

設計の原則は **発想は縛らず、整合だけ縛る**。生成に候補選別やスコアリングは噛ませず、構造化は事後の整合性チェックに限ります。

作品知識はコードに書かず `data/<workId>/work.json` に置きます。コードは作品名やキャラ名を知りません。詳細は [AGENTS.md](AGENTS.md) と [docs/specs/mvp-spec.md](docs/specs/mvp-spec.md) を参照してください。

## 技術スタック

| 層 | 選定 |
|---|---|
| フロント | Next.js (App Router) + React 19 + TypeScript + Tailwind |
| バックエンド | Next.js Route Handlers（別サーバーなし） |
| LLM | Gemini API（`@google/genai`）+ zod 構造化出力 |
| 永続化 | JSON ファイル（`.data/db.json`） |
| ベクトルDB | sqlite-vec（`node:sqlite` に読み込む組み込み型） |
| テスト | Vitest + Testing Library |
| デプロイ | Fly.io（Docker コンテナ 1 台 + 永続ボリューム） |

## セットアップ

Node.js 22 以上が必要です（`node:sqlite` を使います）。

```bash
npm install
cp .env.example .env.local   # GEMINI_API_KEY を記入
npm run dev
```

http://localhost:3000 を開きます。API キーが無い場合、LLM 呼び出しは失敗して定型文にフォールバックします。

### 環境変数

| 変数 | 説明 |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio の API キー（必須） |
| `GEMINI_MODEL` | シオリ・としお・資料係のモデル。既定 `gemini-3.6-flash` |
| `GEMINI_ROUTER_MODEL` | 話題の切り替わりの判定役。既定 `gemini-3.1-flash-lite`（`GEMINI_MODEL` と分けると無料枠を食い合わない） |
| `GEMINI_EMBEDDING_MODEL` | 外部資料のベクトル検索。既定 `gemini-embedding-001` |
| `DATA_DIR` | `db.json` とベクトルDBの置き場所。既定 `./.data` |

### スクリプト

```bash
npm run dev     # 開発サーバー
npm run build   # 本番ビルド
npm start       # 本番サーバー
npm run lint    # ESLint
npm test        # Vitest
```

## デプロイ（Fly.io）

```bash
fly launch --no-deploy --copy-config
fly volumes create data --size 1 --region nrt
fly secrets set GEMINI_API_KEY=...
fly deploy
```

`DATA_DIR` は `fly.toml` で `/app/.data` に設定済みで、永続ボリュームをそこにマウントします。`Dockerfile` はホスト非依存なので Railway / Render でも動きます。

## 画面

| パス | 内容 |
|---|---|
| `/` | 作品選択 |
| `/chat/[sessionId]` | チャット |
| `/reveal/[sessionId]` | 答え合わせ（予想 → 真偽つきの会話） |
| `/debug/[sessionId]` | 管理画面 |

## ディレクトリ

```
app/            画面と Route Handler
components/     chat / reveal / setup / debug / ui
lib/server/     works, store, retrieval, sources, embeddings, vector-db, topic, topic-shift, llm/, reveal/
lib/client/     fetch ラッパー・SSE パーサ
data/<workId>/  作品知識（work.json）。コードはこの中身を知らない
docs/specs/     仕様書
```

## 作品を足すには

`data/<workId>/work.json` を作ります。必要なのは作品情報、外部資料（MediaWiki の記事名と使う章）、編（`arcs`）、話数ごとの要約、本物の設定（`canonFacts`）、キャラの正式名と別名（`entities`）、作り手（`creators`）です。構造は [AGENTS.md](AGENTS.md) の「work.json の構造」を参照してください。

## ブランチ運用

- `main` — 提出・デプロイ用
- `dev` — 統合ブランチ。PR の向き先は `dev`

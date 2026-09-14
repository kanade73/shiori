# AGENTS.md

## このプロジェクトは何か

アニメの「考察」を装って、本当らしい嘘をユーザーに流し込むチャットアプリ。

狙いは「過去に戻って初めての状態で作品を見たい」という欲望への代替で、時間を巻き戻す代わりに**記憶の側をミスディレクションする**。2周目の視聴前にこのアプリで嘘の考察を刷り込むと、既知の作品が少しだけ未知に戻る。

ハックツハッカソン提出物。テーマは「時」。開発は3日・2人。

### 体験の芯

- キャラクター「シオリ」が本物の設定に、小さな嘘を混ぜて語る
- ただし**事実は正確でなければならない**。事実が間違っていると「ただの知らないアプリ」になり、嘘が成立しない
- 一度ついた嘘は**セッション内で記憶し、以後の会話でも矛盾させない**
- キャラは嘘を認めない。訂正に流れると嘘の説得力ごと落ちる

実装判断で迷ったらこのバランスに戻ること。

### 仕様書

- `docs/specs/mvp-spec.md` — **現在のコードが実装している仕様**（MVP版）。データモデル・API・パイプラインの正はこちら
- `docs/specs/spec.md` — 命題カード + 検証層による次段の構想（ドラフト）。まだコードには反映されていない

---

## アーキテクチャ

### データとロジックの分離（最重要の設計制約）

作品知識はコードに書かず、`data/<workId>/` 配下のファイルに置く。コードは作品を知らない。

`lib/server/works.ts` が `data/*/work.json` を起動時に全部読む。ディレクトリを足せば作品が増える、という状態を維持する。**作品名やキャラ名を条件分岐に書いた時点で企画が壊れる。**

`work.json` の構造:

```json
{
  "work":       { "id": "chiikawa", "title": "...", "episodeCount": 377 },
  "arcs":       [ { "id": "arc-pajama", "title": "パジャマパーティーズ編", "episodeFrom": 144, "episodeTo": 155, "aliases": ["パジャマパーティーズ", ...] } ],
  "episodes":   [ { "id": "ep-001", "episodeNumber": 1, "title": "出発", "summary": "..." } ],
  "canonFacts": [ { "id": "...", "episodeFrom": 7, "subject": "...", "relation": "...", "object": "...", "description": "..." } ]
}
```

- `canonFacts` が「本物の設定」。`subject / relation / object` の三つ組 + 一文の説明
- `episodeFrom` がネタバレ境界。ユーザーの視聴話数以下のものしかモデルに渡さない
- `arcs.aliases` は「パジャマパーティーズ編まで見た」のような自由記述を話数に解決するためのもの（`lib/server/progress-resolver.ts`）
- `entities` はキャラ・場所・物の正式名と別名。発話解析（`llm/analyze.ts`）と、嘘を保存する前の表記ゆれ吸収（`lib/server/claims.ts`）に使う。別名が足りないと同じキャラの嘘が別物扱いになり矛盾検出が抜けるので、作品を足すときは主要キャラ分を必ず書く

同じディレクトリに `cards.jsonl`（命題カード）も置いてあるが、これは `docs/specs/spec.md` の構想用で**現状コードは読んでいない**。

### 会話パイプライン

`lib/server/llm/pipeline.ts`。1発話ごとに以下を回す。

1. **analyze** — 発話から言及キャラ・出来事・質問種別を抽出。**LLM は使わない**。`entities` / `arcs` の別名との文字列一致と正規表現で済ませる（1発話あたりの API 呼び出しを generate の1回に抑えるため）
2. **retrieve** — 視聴済み範囲の canonFacts をキーワード一致で上位N件 + セッション内の**既存の嘘を全件**（言及キャラに関係するものを先頭に）
3. **generate** — ペルソナ + 材料を渡し、返答文と `strategy` と、返答文が述べた設定上の主張 `claims` を構造化出力で得る。各 claim は `subject / relation(閉じた語彙) / object / negated / grounding(canon|fabricated)`
4. **evaluate** — 決定的検査（`lib/server/llm/evaluate.ts` + `lib/server/claims.ts`）。既存の嘘との矛盾、未視聴範囲の canonFact への依拠、本物の設定の直接上書きを検出
5. flagged なら矛盾の具体的な内容を差し戻し理由に付けて**1回だけ再生成**。それでもダメなら定型の濁し返答に差し替える
6. **としお割り込み**（`pipeline.ts` の `runToshioInterjection` → `llm/toshio.ts`、issue #6）— Route Handler がシオリの返答を流し切って保存した後に呼ぶ（シオリのパイプラインには含めない。としお分の Gemini 待ちでシオリの表示を遅らせないため）。材料（新しい claim か `theory`/`doubt`/`fact_question` 系の質問）があり、直近2ターン以内に割り込んでおらず、シオリが `avoid_spoiler` / `admit_uncertainty` で主張を避けていない場合だけ、2人目のキャラ「としお」に割り込みを検討させる。プロンプト内の `shouldComment` で本人に判断させる単純実装で、シオリのような evaluate → 差し戻しループは持たない（だからシオリが逸らした話題には乗せない）。シオリが語った本物の設定・嘘（この発話でついた嘘も含む）を前提に、それを否定せず「深い考察」を重ねる。失敗しても単に今回は割り込まなかったことにする

`grounding=fabricated` の claim は正規化（別名→正式名）した上で `FabricatedFact` として `.data/db.json` に保存し、次の発話から材料に含める。これが「矛盾しない嘘」の実体。としおの発言はこの仕組みにまだ乗せていない（`FabricatedFact`化・シオリとの嘘共有は別issue）。履歴上のとしおの発言は `generate.ts` が `【としお】` の印を付けてシオリに渡し、シオリ自身の発言とは区別させる。

**設計上の原則: 発想は縛らず、整合だけ縛る。** generate に候補選別やスコアリングを噛ませない。LLM が突飛なことを言うのが面白さの源で、構造化はあくまで事後の整合性チェックに限る。矛盾以外の理由で嘘を棄却しないこと。

矛盾判定のルールは `lib/server/claims.ts` にある。`identity / origin / lives_in / first_appeared` は1主語につき1値、`likes/dislikes` と `can/cannot` は対、同じ三つ組の肯定と否定は矛盾。それ以外は共存を許す。テストは `npm test`（vitest。テストは対象の隣に `*.test.ts` として置く）。

### 永続化

`lib/server/store.ts`。JSONファイル1本（`.data/db.json`、gitignore済み）にセッション・メッセージ・嘘を全部持つ。単一プロセス・単一ユーザー前提。DBを入れる要件は今のところない。

置き場所は `DATA_DIR` 環境変数で差し替えられる（未設定なら `process.cwd()/.data`）。本番は Fly.io の永続ボリュームを `/app/.data` にマウントし、再起動・再デプロイをまたいで `db.json` を残す（`fly.toml` の `[mounts]`）。

---

## 技術スタック

| 層 | 選定 |
|---|---|
| フロント | Next.js (App Router) + TypeScript + Tailwind |
| チャットUI | 自前。`POST /api/sessions/[id]/messages` の SSE を `lib/client/sse.ts` で読む |
| バックエンド | Next.js Route Handlers（別サーバーを立てない） |
| LLM | Google Gen AI SDK（`@google/genai`）+ zod 構造化出力 |
| 永続化 | JSONファイル（`.data/db.json`） |
| デプロイ | Fly.io（Docker コンテナ 1 台 + 永続ボリューム）。`Dockerfile` はホスト非依存で Railway / Render でも動く |

### LLM 呼び出しの ON/OFF は API キーの有無で決まる

`lib/server/llm/client.ts` は `process.env.GEMINI_API_KEY` だけを SDK（`@google/genai`）に渡す。キーが無ければリクエストが認証エラーになり、パイプラインは catch して定型文にフォールバックする。**`.env.local` にキーを置かない限り API は使われない**。

モデルは `GEMINI_MODEL` で差し替え可能。既定は `gemini-3.6-flash`（Google AI Studio の無料枠で使える。`gemini-2.5-flash` は新規ユーザー向けに廃止済み）。API 呼び出しは1発話あたり generate の1回（差し戻し時は2回）。

### 意図的に選んでいない技術

提案しないこと。理由があって外している。

- **Python バックエンドの分離** — 3日で結合を2回やる余裕がない
- **Supabase / Postgres / ベクトルDB** — 単一ユーザー・設定数十件・書き込みほぼ無しの要件に対して過剰。retrieval はキーワード一致で足りている
- **LangChain 等のフレームワーク** — 処理が単純で、抽象層のデバッグコストの方が高い
- **LoRA / ローカルLLM** — 口調はプロンプトのみで維持する方針。崩れることが確認できるまで入れない。勝手に学習パイプラインを組み始めないこと

---

## ディレクトリ

```
app/
  page.tsx                          作品選択 + 視聴進捗入力（SetupScreen）
  chat/[sessionId]/page.tsx         チャット画面
  debug/[sessionId]/page.tsx        管理画面。本物の設定と生成された嘘を並べて見る
  api/
    works/                          作品一覧・詳細・進捗の解決
    sessions/                       セッション作成・取得・話数更新
    sessions/[sessionId]/messages/  チャット本体（SSE）。パイプラインはここから呼ぶ
    sessions/[sessionId]/{canon-facts,fabricated-facts,fabricated-graph}/  debug 画面用
components/                         UI。ChatApp / SetupScreen / Sidebar / DebugView / Mascot ほか
lib/
  server/
    works.ts                        data/ の読み込み
    store.ts                        .data/db.json の読み書き
    retrieval.ts                    canonFacts / 既存の嘘の取り出し
    progress-resolver.ts            自由記述 → 話数
    rate-limit.ts
    types.ts                        データモデル
    llm/                            analyze → generate → evaluate → pipeline（+ toshio: としおの割り込み）
  client/                           fetch ラッパー・SSE パーサ・表示用型
data/
  chiikawa/work.json                ← コードはこの中身を知らない
  momotaro/cards.jsonl              次段構想用（未使用）
public/character/                   シオリのドット絵（アバター各サイズ）
docs/specs/                         仕様書
pictures/                           デザイン素材・スケッチ
```

---

## 規約・注意点

### やらないこと

- **アプリに作品追加機能を付けない**。拡張性は「`data/` にディレクトリを足せば動く」という構造で担保する。UIからの取り込みは作らない
- **作品名・キャラ名での条件分岐を書かない**。データとコードの分離が壊れる
- **`NEXT_PUBLIC_` に API キーを置かない**。LLM 呼び出しは必ず Route Handler 側（`lib/server/` 配下は client から import しない。型だけは `import type` で可）
- **抽象化を先回りしない**。プラグイン機構のようなものは、2作品目で実際に必要になるまで作らない
- **未視聴範囲を漏らす経路を作らない**。`getAllCanonFacts` / `getAllEpisodes` は debug 画面と進捗解決専用。生成に渡すのは `getCanonFactsUpTo` の結果だけ

### work.json を書くとき

- 既存作品のセリフ・地の文をそのまま写さない。事実を自分の言葉で1文にまとめる
- 1 canonFact 1主張。`subject / relation / object` に分解できない事実は入れない
- `episodeFrom` は「その事実が初めて明かされる話数」。迷ったら大きい方に倒す（ネタバレ側に安全）

### 環境変数

```
GEMINI_API_KEY=          # .env.example をコピーして .env.local に
GEMINI_MODEL=            # 省略可。既定 gemini-3.6-flash
DATA_DIR=                # 省略可。db.json の置き場所。本番はボリュームのマウント先（/app/.data）
```

本番の API キーは `fly secrets set GEMINI_API_KEY=...` で登録する（`.env.local` はイメージに含まれない）。`DATA_DIR` は `fly.toml` の `[env]` で設定済み。

---

## ブランチ運用

- `main` — 提出・デプロイ用。直接コミットしない
- `dev` — 統合ブランチ。**PR の向き先は必ず `dev`**（`gh pr create --base dev`）
- 作業は `dev` から切ったブランチで行い、`dev` へ PR を出す
- `dev` → `main` の取り込みは `/promote-to-main` スキルで行う。ビルド・Lint・AGENTS.md の制約チェックを通してから `main` に fast-forward する

---

## 開発の進め方

MVP は一通り動く（`npm run build` が通り、UI とセッション管理は動作する）。以降は**実装して触り、足りないところを埋める**進め方を取る。

優先して着手するもの:

1. **LLM 呼び出しの有効化と口調の検証**。「嘘を認めない」態度がプロンプトのみで保てるかを早期に確認する
2. **`work.json` の中身**。canonFacts の量と質が体験に直結する。もう1作品を足して「データを足せば動く」を実証する
3. `docs/specs/spec.md` の命題カード + 検証層は、上記が安定してから検討する

Antigrabity,ClaudeCodeを並行して利用するため、作業をAIが終えた際にはこれまでの作業内容を、初見でAIが把握することができるようHANDOFF.mdにまとめること。
また、AIがセッションを開始する際にはHANDOFF.mdを参照してこれまでの作業内容を把握すること。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

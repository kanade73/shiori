# HANDOFF

AIがセッションを開始する際はまずこれを読むこと（AGENTS.md参照）。作業を終えるAIは、次のAIが初見で状況を把握できるようここを更新してから終わること。

## 現在の状態（最終更新: このセッションの終わり）

- 作業ブランチ: `feat/issue-6-toshio`（`dev` から分岐）
- 未マージPR: **#8** `feat: 「としお」の割り込み考察を追加` → `dev` 向き。まだレビュー・マージ待ち。issue #10（としおのプロフ画像）も同乗していて、#8 のマージで #6 と #10 の両方が閉じる（PR本文に `Closes #6` / `Closes #10`）
- `git status` はクリーン。コミット済みの内容がそのまま現在の実装

## 直近のセッション: issue #10「としお専用のプロフ画像」
- ユーザーが用意した `public/character/toshio-{64,128,256}.png` / `toshio-display-512.png` を配置し、`Mascot` に `character` props を追加して話者ごとに画像を出し分け（コミット `c353a75`）
- 追加修正: `Mascot` の `character` の型を独自の `MascotCharacter` から既存の `Speaker`（`lib/server/types`）に寄せ、`ChatMessageItem` は `message.speaker` をそのまま渡す（未設定ならシオリ）
- 追加修正: としおの `message-start` 直後（本文が空の間）に出る `TypingIndicator` がシオリの顔固定だったので、`speaker` を受け取ってとしおの顔を出すようにした
- テスト: `components/ChatApp.test.tsx` に吹き出しごとの画像と、としおの入力中表示の画像を検証するケースを追加
- #10 を別PRに分けず #8 に同乗させたのはユーザー判断（#10 は #6 の `speaker` に依存しており、#8 のブランチには相方のコミットもあるため force push を避けた）

## その前のセッションでやったこと

### 1. issue #6「としおくん追加」の実装（PR #8, コミット `711b694`）
- `lib/server/llm/toshio.ts`（新規）: 2人目のキャラ「としお」。モデルは岡田斗司夫（issue #6のコメント参照）。`shouldComment`/`message` を構造化出力で得る単純なプロンプト制御実装。シオリのような evaluate→差し戻しループは**持たない**（issueで明示的に将来課題）
- `lib/server/llm/pipeline.ts`: `runToshioInterjection` として切り出し、Route Handler がシオリの返答を流し切って保存した後に呼ぶ（レビュー後の変更。もとは `runConversationPipeline` の末尾で呼んでいたが、としお分の Gemini 待ちがシオリの表示まで遅らせていた）。`claims`があるか質問種別が`theory`/`doubt`/`fact_question`のときだけ、直近2ターン以内に割り込んでおらず、シオリが `avoid_spoiler`/`admit_uncertainty` で主張を避けていなければ検討する（`turnsSinceLastToshio` / `worthAskingToshio` としてexport、テスト済み）
- `Message`型に`speaker?: "shiori" | "toshio"`を追加（省略時はシオリ扱いで既存データと後方互換）
- SSEプロトコルに`message-start`/`message-end`を追加し、1回の送信でシオリ→としおと複数発話をストリームできるようにした（`lib/client/api.ts`の`SendMessageHandlers`も変更）。`ChatApp` は送信と同時に placeholder の吹き出し（入力中表示）を積み、最初の `message-start` をそれに充てる
- `generate.ts`: 履歴上のとしおの発話に `【としお】` の印を付けてシオリに渡す（連続する assistant が1つの model ターンに畳まれるため、印が無いとシオリがとしおの文章を自分の発言として見る）。ペルソナにも「としおの考察を自分が言ったことにしない」を追記
- UI: `ChatMessageItem`がとしおの発話に名前+「考察」バッジを表示。プロフ画像は当初シオリのものを代用していたが、issue #10 で専用画像に差し替え済み（上記）
- テスト追加: `lib/server/llm/toshio.test.ts`, `lib/server/llm/pipeline.test.ts`。レビューで `pipeline.toshio.test.ts`（呼び出し条件・材料）, `app/api/sessions/[sessionId]/messages/route.test.ts`（SSE の並び・speaker 付き保存・切断後も保存）, `lib/client/api.test.ts`, `components/ChatApp.test.tsx` を追加。`vitest.config.ts` に `@/` alias と `app/api/**/*.test.ts` を追加

### 2. SSEのenqueue-after-closeバグ修正（PR #8, コミット `7995365`）
- 症状: ユーザーから「問いかけに返事がない」と報告
- 原因: クライアント切断等で`ReadableStream`のcontrollerが閉じた後に`send()`が呼ばれ、`enqueue`が例外に。`catch`側のフォールバック送信も同じ理由で失敗し、何も返らないまま消えていた（ログに`TypeError [ERR_INVALID_STATE]: Invalid state: Controller is already closed`）
- 対処: `app/api/sessions/[sessionId]/messages/route.ts`に`closed`フラグを追加し、`send()`をガード。`cancel()`でも`closed`を立てる

### 3. Gemini呼び出しの2つの不具合対応（このセッションの前半、issue #6着手前）
- `gemini-2.5-flash`が新規ユーザー向けに廃止されていて404だったのを`gemini-3.6-flash`に変更（`lib/server/llm/client.ts`のデフォルト。コミット済み・mainの前提）
- **[未解決・要フォロー]** `gemini-3.6-flash`の無料枠は**1日20リクエスト**とかなり少なく、このセッション中に使い切った（`429 RESOURCE_EXHAUSTED`, `GenerateRequestsPerDayPerProjectPerModel-FreeTier`）。一時的に`.env.local`（gitignore対象・コミットされない）に
  ```
  GEMINI_MODEL=gemini-3.5-flash-lite
  ```
  を追加して回避している。**日付が変わって3.6-flashの枠が戻ったらこの行を消してデフォルトに戻してよい。** それまでは3.5-flash-liteのまま動く
  - 試した中で `gemini-flash-latest` は動くが混雑時に503が出やすい。`gemini-2.5-flash-lite` 等の2.x系はすべて新規ユーザー向けに廃止済み(404)。`v1beta/models?key=...`で利用可能モデル一覧を確認できる

### 4. devサーバーの並行起動（このセッションの前半、issue #6着手前）
- このNext.js（カスタム版）は`distDir`単位でdevサーバーのロックファイルを持つため、同じディレクトリで2つ目の`next dev`を素で起動すると即終了する
- `next.config.mjs`に`NEXT_DIST_DIR`環境変数での`distDir`切り替えを追加（未設定時は従来通り`.next`）
- `.gitignore`に`.next-*/`、`eslint.config.mjs`のignoreに`.next-*/**`を追加
- 使い方: `NEXT_DIST_DIR=.next-3001 npm run dev -- -p 3001`
- **注意**: ポート3000番のdevサーバーはこのリポジトリと同じ作業ディレクトリを見ている（git worktreeは分かれていない）。ブランチ切り替えやファイル編集は3000番の表示にも即座に影響する

## 次にやるとよいこと

- PR #8 のレビュー・`dev`へのマージ
- としおの発話は現状`FabricatedFact`化されていない（issue #6のスコープ外として明示的に見送った）。「シオリとの嘘共有」は別issueで
- `GEMINI_MODEL`の日次枠状況を見て、必要なら`.env.local`を`gemini-3.6-flash`に戻す（または恒久的に3.5-flash-liteのままにするか判断する）

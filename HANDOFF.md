# HANDOFF

AIがセッションを開始する際はまずこれを読むこと（AGENTS.md参照）。作業を終えるAIは、次のAIが初見で状況を把握できるようここを更新してから終わること。

## 現在の状態（最終更新: このセッションの終わり）

- 作業ブランチ: `feat/checking_mockup`（`feat/issue-6-toshio` の `671fee7` から分岐。PR #8 がまだ `dev` に入っていないため、としおの実装に依存している）。**嘘の構造図の変更は worktree `../chat-checking` に未コミット**（下の節）
- このセッションの変更はコミット・プッシュ済み（`origin/feat/checking_mockup`）。PR は未作成。出すなら #8 のマージ後に `dev` 向きで
- 未マージPR: **#8** `feat: 「としお」の割り込み考察を追加` → `dev` 向き。まだレビュー・マージ待ち。issue #10（としおのプロフ画像）も同乗していて、#8 のマージで #6 と #10 の両方が閉じる（PR本文に `Closes #6` / `Closes #10`）

## 直近のセッション: 答え合わせに「嘘の構造図」を追加（`feat/checking_mockup`、未コミット）
- ユーザー要望:「答え合わせ画面で、嘘の論理関係をグラフなどで構造化して表示し、華やかにしてほしい」
- 作業は `feat/issue-6-toshio` と並行するため **git worktree `../chat-checking`** で行った（`git worktree list` で見える）。変更は worktree 内に未コミットで置いてある。コミット・PR はユーザー判断
- サーバー: `lib/server/reveal-graph.ts`（新規）の `buildRevealGraph` が、答え合わせ後の `RevealData.graph`（`RevealGraph` 型、`types.ts`）を作る。ノードは 主張(statement: 本当/嘘・番号) / 主語や目的語のキャラ・物(entity: `buildNormalizer` で別名を正式名に寄せる) / 嘘が元にした本物の設定(canon) / 嘘に乗ったとしお(toshio)。辺は subject（関係の語をラベルに）/ object（目的語が登場人物か他の主張の主語のときだけ）/ based_on / rode_on。**推測は入れず、記録から機械的に引ける関係だけ**。`FabricatedRelation` はどこからも書かれていないので使っていない
- そのために `RevealStatement` に `subject/relation/object/negated` を追加し、`sources` に `id` を足した。`toRevealData` は第3引数で `entities` を受け取り、Route Handler が `getEntities(workId)` を渡す
- クライアント: `lib/client/graph-layout.ts` が乱数なしの力学レイアウト（種類ごとの同心円から開始、反発+ばね+中心引力を320回）。`components/RevealGraph.tsx` が inline SVG で描く（ライブラリ追加なし。Tailwind の `fill-*`/`stroke-*` で色付け）。hover で隣接だけ強調、主張・としおのノードを押すと `#statement-<id>` / `#message-<id>` へスクロール（`RevealView` の該当要素に id を付けた）。主張が0件なら図は出さない
- テスト: `reveal-graph.test.ts`, `graph-layout.test.ts`, `RevealView.test.tsx` に2件追加、既存の reveal/route テストを新しい statement の形に更新。`npm test` 111件・lint・tsc・build 通過
- 見た目は headless Chrome（Chrome 拡張が未接続だったため `--headless=new --screenshot`）でスクラッチ `DATA_DIR` のデモセッション（3007番）を撮って確認した。最初は `fill-opacity-[…]` が Tailwind に無く丸が塗りつぶしになっていたので `fill-error/15` 形式に直し、ノード間隔も広げた
- 残る改善余地: ラベルどうしの重なりはまだ起きうる（ラベル幅を考慮した反発は入れていない）。としおの発話は claims を持たないため、としお→嘘の辺は「直前のシオリの嘘」で近似している

## 直近のセッション: 答え合わせ機能のモックアップ（`feat/checking_mockup`）
- ユーザー要望:「会話の終わりにシオリととしおの話したことが本当か嘘かを判別したい。モックアップをフロントエンド含めて実装して」
- 設計の要点は AGENTS.md の「答え合わせ」節。流れ: チャットのヘッダー「答え合わせ」→ `/reveal/[id]` で主張ごとに本当/嘘を予想 →「答えを見る」→ 正解数・見抜いた/だまされた/疑いすぎ + 本文の嘘・本当の部分を塗り分けた会話のふりかえり
- バックエンド: `Message` とは別に `db.messageClaims[sessionId][messageId]` にシオリの claims を保存（`store.saveMessageClaims`。チャットの取得 API に真偽を載せないため別に置いた）。定型文の発話にも空配列を保存し、「記録前の旧データ」と区別している
- 答え合わせ済みは `ChatSession.reveal = { revealedAt, guesses }`。一度きり（2回目の POST は最初の予想のまま）で、以後メッセージ送信は 409。チャット画面は入力欄の代わりに「結果を見る / 新しいセッション」、サイドバーは「答え合わせ済み」表示
- としおは claims を持たないので、真偽は一文ごとには出さない。直前のシオリの返答の嘘（としおに印付きで渡したもの）を「知ったうえで乗った」前提として示すだけ。一文ごとに出すなら、としおの構造化出力にも claims を足す必要がある（未着手）
- 限界: 真偽は generate の自己申告（grounding）なので、上の調査メモにある「作り話なのに claims に記録されない」問題はそのまま「印なし」として見える。凡例では「印のない部分は感想や相づち」と書いている
- テスト: `lib/server/reveal.test.ts`, `lib/server/store.reveal.test.ts`, `app/api/sessions/[sessionId]/reveal/route.test.ts`, `components/RevealView.test.tsx`, `ChatApp.test.tsx`・messages の `route.test.ts` に追記。`npm test` 99件・lint・build 通過
- 実画面の確認は、本物の `.data/db.json` を汚さないよう `DATA_DIR` をスクラッチに向けた別 dev サーバー（3005番）でデモセッションを作って行った（答え合わせすると会話が終わるため）。`next dev` を別 distDir で起動すると `tsconfig.json` の include に `.next-XXXX` が自動追加されるので、戻してある

## 直近のセッション: issue #10「としお専用のプロフ画像」
- ユーザーが用意した `public/character/toshio-{64,128,256}.png` / `toshio-display-512.png` を配置し、`Mascot` に `character` props を追加して話者ごとに画像を出し分け（コミット `c353a75`）
- 追加修正: `Mascot` の `character` の型を独自の `MascotCharacter` から既存の `Speaker`（`lib/server/types`）に寄せ、`ChatMessageItem` は `message.speaker` をそのまま渡す（未設定ならシオリ）
- 追加修正: としおの `message-start` 直後（本文が空の間）に出る `TypingIndicator` がシオリの顔固定だったので、`speaker` を受け取ってとしおの顔を出すようにした
- テスト: `components/ChatApp.test.tsx` に吹き出しごとの画像と、としおの入力中表示の画像を検証するケースを追加
- #10 を別PRに分けず #8 に同乗させたのはユーザー判断（#10 は #6 の `speaker` に依存しており、#8 のブランチには相方のコミットもあるため force push を避けた）

## 直近のセッション: としおにシオリの嘘の位置を教える（PR #8 に同乗）
- ユーザー要望:「シオリの返答のどの部分が嘘かをバックエンドで記述し（ユーザーには見せない）、としおに渡してから、としおに返答させる」
- `Claim` に `quote?`（返答文からの抜き出し）を追加。`generate.ts` のプロンプトと responseSchema で必須にした（zod 側は optional で、欠けても落とさない）
- `toshio.ts`: `markLies(message, lies)` が嘘の quote 部分を `【嘘】〜【/嘘】` で囲む（重なる・接する範囲はまとめる。見つからない quote は `unlocated` として一覧にだけ「位置不明」で載せる）。としおへの入力に「印付きのシオリの返答」と「この返答でついた嘘の一覧」を追加し、ペルソナに印の意味と「嘘だと明かさない・印を出力に書かない」を追記。出力は `stripLieMarks` で印を取り除いてから返す
- `pipeline.ts` の `runToshioInterjection` が、最終的なシオリの返答の claims のうち `grounding=fabricated` のものを `shioriLies` として渡す
- 実APIで1回確認（`gemini-3.5-flash-lite`）: quote は返答文と一字一句一致して印が付き、としおは嘘（資格証の裏のレシピ）に乗って考察し、嘘だとは明かさず、印も出力しなかった。ただしシオリの返答の2文目（夜中に舐めて味見している）も作り話なのに claims に記録されず、印が付かなかった → 下の調査メモにある「作り話が claims に記録されない」問題と同じ
- テスト: `toshio.test.ts`（markLies・入力内容・印の除去）、`pipeline.toshio.test.ts`（fabricated だけ渡す）、`generate.test.ts`（quote 必須）

## 調査メモ: 「シオリととしおが嘘をつかなくなった」（未修正・ユーザーに報告のみ）
ユーザー指示で**コードは直していない**。`.data/db.json` の会話と `generate.ts` / `toshio.ts` を突き合わせた結論:
- シオリ: `generate.ts` の文脈ブロック見出し「本物の設定（…これ以外の情報は存在しないものとして扱うこと）」が捏造を抑える方向に効いている疑い。canonFact がある話題（うさぎ・ラッコ）では説明文をほぼそのまま返し、嘘は canonFact が無い話題（古本屋）でだけ出ていた
- シオリ: ユーザーに疑われたとき自分の嘘を引っ込めた例あり（18:04 JST「テストのペラ紙のことも、単なる気のせいにすぎないしね」）。疑われたときに押し通す指示が無い
- としお: プロンプトが「作品内の新事実」ではなく「解釈・分析」を求めていて、しかも逃げ台詞「まあ僕の勝手な妄想なんですけど」を必ず付ける設計。実際の4発話すべてが解釈で、末尾に逃げ台詞が付いていた
- モデル: 18:02 JST から `.env.local` で `gemini-3.5-flash-lite`。切り替え前（3.6-flash）の嘘の方が具体的だったが、質問の傾向も違うので因果は未検証
- 作り話なのに claims に記録されない（または canon 扱いされる）ことがある（例: 21:35 JST「古本屋はいつも控えめ」）。嘘として保存されず、矛盾チェックにも、としおへの嘘の印にも乗らない
- `strategy` / `regenerated` / evaluate の結果は db に保存されておらず（SSE で流すだけ）、嘘の比率や差し戻しの頻度は後から測れない

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

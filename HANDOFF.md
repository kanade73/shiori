# HANDOFF

AIがセッションを開始する際はまずこれを読むこと（AGENTS.md参照）。作業を終えるAIは、次のAIが初見で状況を把握できるようここを更新してから終わること。

## 直近の修正: 答え合わせの情報配置と文章（2026-09-15）
- ユーザー指定の `localhost:3002/reveal/demo` は、この `chat-checking` worktree が配信元。変更は未コミット。
- RevealView: 結果の概要 → 発言順の答えと根拠 → 真偽をマークした会話 → 折りたたみの構造図に整理。重複する真偽一覧・左目次・本文下の答えを削除。幅は800pxの1カラム。
- リングと煽り見出しを削除し、嘘の件数と予想した件数に対する正解数を明記。「疑いすぎ」「だまされた」を予想内容の表記に変更。未判定の文章を感想と断定しない凡例に修正。構造図の接続機能は維持。
- 確認: RevealView既存6テスト、対象ファイルのESLint、tsc、git diff --check通過。3002の対象URLはHTTP 200。ブラウザ接続なし・ネイティブ画面操作の権限待ちのため目視確認は未実施。
- 既存の未コミット変更に重ねている。元のchat worktreeには実装変更していない。

## 現在の状態（最終更新: このセッションの終わり）

- 作業ブランチ: `feat/checking_mockup`（`feat/issue-6-toshio` の `671fee7` から分岐。PR #8 がまだ `dev` に入っていないため、としおの実装に依存している）。**嘘の構造図の変更は worktree `../chat-checking` に未コミット**（下の節）
- このセッションの変更はコミット・プッシュ済み（`origin/feat/checking_mockup`）。PR は未作成。出すなら #8 のマージ後に `dev` 向きで
- 未マージPR: **#8** `feat: 「としお」の割り込み考察を追加` → `dev` 向き。まだレビュー・マージ待ち。issue #10（としおのプロフ画像）も同乗していて、#8 のマージで #6 と #10 の両方が閉じる（PR本文に `Closes #6` / `Closes #10`）

## 直近のセッション: 嘘の構造図を「左から右へ一方向」の層状レイアウトに変更（`feat/checking_mockup`、未コミット）
- ユーザー指摘:「グラフが人が見て分かる形になっていない。一貫性があるなら矢印は一方向であってほしい」
- 力学レイアウトを捨て、`lib/client/graph-layout.ts` を層状に書き直した。列は左から **本物の設定 → キャラ・物 → シオリが語った設定（会話順に上から下） → としおの考察**。他の列はつながった主張の高さの平均に寄せ、同じ列内の重なりは上から順にずらして解く（`resolveColumn`）
- 描画上の辺の向きは常に左の列 → 右の列（`layoutGraph` で from/to を x で正規化）。データ上の向き（主張 → 本物の設定、としお → 主張）とは別。**目的語の辺（`object`）は逆向きになるので図には描かない**（`isForwardEdge`。データは残っている）
- `components/RevealGraph.tsx`: ノードは丸ではなく列幅の角丸矩形（主張は番号バッジ + 短い本文、本物の設定は話数 + 説明、としおは顔アイコン）。辺は右向きのベジェ曲線 + 矢印。列見出しを SVG 内に描く。SVG は `width=100%` でカード幅に縮み、`min-width 640px` を切ると横スクロール
- **注意: この作業中に `components/RevealView.tsx` と `RevealView.test.tsx` が別の編集者（並行作業中の Antigravity か別セッション）によって全面的に書き換えられた**（00:17 JST）。私の Hero / VerdictColumns / StatementIndex はもう無く、代わりに「会話に混ざっていた嘘」の統計ヘッダー → 「話の答え」一覧 → ふりかえり → `<details>` 折りたたみの中に構造図、という配置になっている。こちらは上書きしていない。構造図側の変更（`RevealGraph.tsx` / `graph-layout.ts` / そのテスト）はその新しい `RevealView` と組み合わせて動作し、`npm test` 114件・lint・tsc 通過
- 確認: `scratchpad/shotgraph.mjs`（details を開いてから構造図カードだけを 2x で撮る）で 1200px を確認

## 直近のセッション: 答え合わせの結果画面の配置を作り直し（`feat/checking_mockup`、未コミット）
- ユーザー要望:「Mobbin の MCP で答え合わせページの情報配置を調査し、このアプリの色調に合う配置を取り入れてフロントを作り直す。スクリーンショットで確認まで行う」
- Mobbin で参照した画面: Babbel の結果画面（クリーム地・中央の大きなスコア・「Incorrect / Correct」の2カラムのチップ）、Codecademy（上にリング型スコア、下は左に設問一覧・右に詳細）、Quizlet（ドーナツと凡例の横並び）。暖色のクリーム地と紫のトーンが近い Babbel を主に採った
- 新しい配置（`components/RevealView.tsx` の結果フェーズ）: **Hero**（判定の一言 `headline()` + `ScoreRing` + 見抜いた/だまされた/疑いすぎ/予想なし/としお の数）→ **VerdictColumns**（嘘 / 本当 の2カラム。チップを押すと `#statement-<id>` へ）→ 嘘の構造図 → 「会話をふりかえる」は `lg` 以上で **左に `StatementIndex`（sticky の目次）、右に Transcript** の2カラム。結果フェーズだけ `Shell wide` で最大幅 1040px。予想フェーズは変えていない
- 旧 `ScoreSummary` / `StatTile` は削除。テストの文言（「/ 2 件 正解」「見抜いた」「疑いすぎ」等）は維持し、複数箇所に出るようになった「見抜いた」「疑いすぎ」は `getAllByText` に変更
- 確認: `npm test` 111件・lint・tsc 通過。スクリーンショットはスクラッチに入れた **puppeteer-core**（システムの Chrome を使う。`scratchpad/shot.mjs` / `probe.mjs`）で 1200px と 400px を撮った。Chrome の `--headless --screenshot --window-size=400` は最小ウィンドウ幅の都合で 400px の検証には使えない（実際より広く描かれる）ので注意
- ユーザーからの差し戻し「配色がおかしい・スカスカ」を受けて再調整: 大きなベージュ面（`bg-surface-card` の xl カード）と色数の多い数字をやめ、チャット・作品選択画面と同じ **細い罫線のカード（`rounded-lg border-hairline bg-canvas`）** に統一。数字の色は嘘=error・本当=success だけ、リングは primary 1色。`lg` 以上ではヒーロー（2fr）と嘘 / 本当一覧（3fr）を横並びにして余白を埋め、最大幅は 960px。構造図のカードも同じ罫線スタイルに
- 直したバグ: 400px で「嘘 / 本当」のグリッド列がチップの min-content に引っ張られて横にはみ出していた → 列の div に `min-w-0`。構造図の SVG だけは意図的に `overflow-x-auto` 内で横スクロール

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

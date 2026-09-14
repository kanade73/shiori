# HANDOFF

AIがセッションを開始する際はまずこれを読むこと（AGENTS.md参照）。作業を終えるAIは、次のAIが初見で状況を把握できるようここを更新してから終わること。

## 現在の状態（最終更新: このセッションの終わり）

- 作業ブランチ: `feat/issue-6-toshio`（`dev` から分岐）
- 未マージPR: **#8** `feat: 「としお」の割り込み考察を追加` → `dev` 向き。issue #10（としおのプロフ画像）も同乗していて、#8 のマージで #6 と #10 の両方が閉じる
- 直近のコミットで会話パイプラインを「生成は会話だけ／主張の分解は別呼び出し／守りは evaluate」に組み替えた（下のセクション）。**まだ push していない**
- ポート 3001 で dev サーバーを `GEMINI_MODEL=gemini-3.5-flash-lite` 付きで起動したまま（`gemini-3.6-flash` の日次 20 回枠を使い切ったため。`.env.local` は変えていない）。停止は `pkill -f "next dev -p 3001"`

## 直近のセッション: 長いセッションで嘘をつかなくなる問題への組み替え

ユーザーの方針: 「LLM には自由度を持たせたい。バックエンドで矯正するのは好みではない」。なので制御を足すのではなく、**生成から制約を外して事後の検査に押し出す**方向にした（AGENTS.md「発想は縛らず、整合だけ縛る」）。

原因の見立て: プロンプトに「既に語った設定の全件」「絶対に矛盾させるな」「claims をすべて記録・quote は一字一句」が積まれ、セッションが長いほどモデルが自己監視に寄って嘘をやめる。要約・圧縮の仕組みは元々無く、嘘の全件渡しが線形に伸びていた。

変更:
- `generate.ts`: `generateResponse` → `generateReply`。構造化出力をやめ、返答文だけを返す。ペルソナは約 6,000 字 → 約 1,000 字（strategy の選択肢・比率・claims 規則・としおの説明・spoilerRisk を削除）。canonFacts は description だけ、id は渡さない。履歴からとしおの発話を落とす（`【としお】` 印は廃止）
- `extract.ts`（新規）: `extractClaims(workTitle, message, canonFacts)`。返答文から主張を構造化出力で取り出す 2 回目の呼び出し。grounding は渡した canonFacts に基づくかで判定。**1 発話あたりの API 呼び出しは generate + extract の 2 回**（差し戻し時は 4 回）。無料枠を倍速で消費する点に注意
- `retrieval.ts`: `retrieveFabricatedFacts` は言及キャラに関係する嘘を新しい順に最大 8 件（生成の「前に話したこと」用）。新設 `getActiveFabricatedFacts` が全件で、evaluate はこちらと照合する
- `pipeline.ts`: generate → extract → evaluate → 差し戻し 1 回 → 定型文。`strategy` はモデルに選ばせず、保存結果から事後に決める（新しい嘘あり=introduce_small_lie、既存の言い直し=reinforce_existing_lie、それ以外=no_new_lie、定型文=admit_uncertainty）。UI のバッジととしおのゲーティングにだけ使う
- `types.ts` / `schemas.ts`: `Claim.quote`、`GenerationResult.usedExistingFactIds` / `spoilerRisk` を削除。`evaluate.ts` の spoilerRisk は sourceCanonFactIds の未視聴チェックだけになった
- `toshio.ts`: 「嘘の位置を印で教える」方式（`markLies` / `stripLieMarks` / `【嘘】`）を廃止。代わりにそのターンの fabricated claims を **「今回の題材」** として渡し、本作の事実として乗って考察を重ねるよう指示する。としおは嘘か本当かを見分ける必要がなくなった（claims の記録漏れがあっても印が欠けるのではなく、題材が減るだけ）
- `route.ts`: `HISTORY_LIMIT` 16 → 12（としおを落とすので実質ユーザー↔シオリ 5〜6 往復）
- テスト: `generate.test.ts` 書き換え、`extract.test.ts` 新規、`toshio.test.ts` / `pipeline.toshio.test.ts` を題材方式と 2 段呼び出しに合わせて更新。75 件通過、`tsc` / `eslint` / `build` OK

実 API 確認（`gemini-3.5-flash-lite`、第 30 話設定、3 ターン）: 3 ターンとも嘘が出て、抽出された嘘が 7 件保存され、としおは題材（地下労働の歴史）に乗って考察した。差し戻しは 0 回。**逆に毎ターン嘘をついていて、素直な共感だけの返答が出ていない**。長いセッションでの頻度はまだ未計測

## 次にやるとよいこと（このセッション分）
- 長いセッション（20 ターン以上）で嘘の頻度が落ちないかを実測する。`strategy` は db に保存されないので、測るなら `metadata` を残すか db.json の fabricatedFacts の createdAt で数える
- 嘘の頻度が高すぎるなら、ペルソナの「素直な共感だけの返答も混ぜて」の一文を強めるか、直近 N ターンで嘘をついた回数を 1 行添える（矯正にならない範囲の促し）
- extract の記録漏れ（作り話が canon 扱いになる）は残課題。`extract.test.ts` はモック検証のみ
- 直下 `HANDOFF.md` と `docs/HANDOFF.md` の二重化は未解消。`docs/HANDOFF.md` には別セッションの未コミット差分が乗っているので触っていない

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

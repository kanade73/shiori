# HANDOFF

AIがセッションを開始する際はまずこれを読むこと（AGENTS.md参照）。作業を終えるAIは、次のAIが初見で状況を把握できるようここを更新してから終わること。

コードの構造・設計原則は AGENTS.md が正。ここには「いまどこまで進んでいて、何が決まっていて、何が未解決か」だけを書く。過去セッションの作業ログは残さず、必要なら git log を読む。

## 2026-09-15: 答え合わせで本文に位置を付けられなかった主張を表示（dev に直コミット）

dev → main 昇格前のレビューで見つけた表示漏れ。`ResultPhase.tsx` は本文の印だけを出していたため、旧セッションの quote が無い嘘や、抜き出しが本文と一致しなかった主張が答え合わせから消えていた。`RevealMessage.statementIds` にはあるが `segments` に現れない主張を、本文の下に印付き（嘘/本当）の一覧で出すようにした（`data-testid="reveal-unplaced"`）。位置が分かる主張は本文の印だけで、一覧には重ねない。テストは `RevealView.test.tsx` に追加。これで dev → main の昇格判定は OK（build / tsc / lint / test 全通過、fast-forward 可）。

## 2026-09-15: claims 抽出に Gemini の経路を戻した（`fix/extract-gemini`、dev `4913fd5` から切った。**PR #40** → `dev`、未マージ）

`31caf67`（PR #37）で抽出から Gemini の経路を消していたので、手元の推論（Ollama / LoRA サーバ）を何も設定していないと claims が毎回空になり、**答え合わせの嘘/本当の印が1つも付かなかった**（印は claims の `quote` の位置に付けるため。描画のコードは消えていない）。Ollama の経路（PR #39）は残したまま、Gemini だけでも動くようにした。

- `lib/server/llm/extract.ts`: 経路は `extractRoute` が **Ollama（`EXTRACT_OLLAMA_MODEL`）→ LoRA サーバ（`EXTRACT_ENDPOINT`）→ Gemini** の順に、設定のある最初の1つを選ぶ。`ExtractBackend` に `"gemini"` を戻した。Gemini には Ollama と同じ `EXTRACT_PROMPT` / `buildExtractUserPrompt` を構造化出力（`GEMINI_CLAIMS_SCHEMA`）で投げる
- **フォールバックはしない**（#37 の「Gemini に落ちて動いてしまうと LoRA の出来が測れない」という判断を残した）。選んだ経路が落ちたら warn 1行 + claims 空。Gemini が 429 などで失敗したときも同じ（以前は例外を投げて pipeline の catch で拾っていた）
- `extractEndpoint()` は未設定で例外 → `null` を返すように戻した
- `client.ts` に `EXTRACTION_MODEL`（`GEMINI_EXTRACT_MODEL`、既定 `gemini-3.1-flash-lite`）を戻した。以前の既定 `gemini-3.5-flash-lite` はいまシオリの `GEMINI_MODEL` の既定と同じで、無料枠（モデルごとに1分15回）を食い合うため、判定役（`GEMINI_ROUTER_MODEL`）と同じモデルにした
- `.env.example` / `AGENTS.md` を3経路の記述に直した
- 検証: `npm test` 407件・`tsc --noEmit`（`.next/` 以外）・eslint 通過。実際の Gemini での抽出はまだ試していない

## 2026-09-15: 画面の整理（`fix/feature-tweaks`、dev `be08761` から切り、#37 マージ後の `origin/dev` を取り込み済み。**PR #38** → `dev`、未マージ）

ユーザー指示の4点 + 追加の8点（結果画面の考察バッジ・話数の表示・結果画面の「話の答え」・嘘の件数と印の番号・サイドバーの「生成された嘘」・削除の確認ダイアログ・セッション一覧の件数・「新しいセッション」と「別の会話を始める」の遷移先）。ユーザー指示で PR まで出した（マージは未）。#37（claims 抽出の LoRA 化）とは HANDOFF.md 以外で触るファイルが重ならない。

- **セッションの削除**: サイドバーの各セッションの右にゴミ箱（`components/ui/icons.tsx` の `TrashIcon`）。確認は `components/chat/DeleteSessionDialog.tsx`（画面中央にシオリの絵と吹き出し「ほんとうに消しちゃうの...?」+ 対象の見出し。はい/いいえの2択で、「いいえ」は「はい」の1.5倍 = 144×60px・24px 対 96×40px・16px。開いたときのフォーカスは「いいえ」、Esc・背景のクリックも「いいえ」扱い。失敗したら閉じずにエラーを出す）→ `DELETE /api/sessions/[sessionId]` → `store.deleteSession`（sessions・messages・fabricatedFacts・fabricatedRelations・messageClaims をまとめて消す）。開いているセッションを消したら `/` へ移る。ダイアログの開閉と削除は `ChatApp`（`requestDeleteSession` / `confirmDeleteSession`）、`Sidebar` は `onDeleteSession` を呼ぶだけ
- **「新しいセッション」**: サイドバーのボタンと、答え合わせ済みの会話の下のボタンは、スタート画面（`/`）へのリンクをやめ、`ChatApp.startNewSession` で今の作品のセッションを作ってそのチャットに移る（スタート画面の「シオリと話す」と同じ `createSession` → `router.push`）。同じ `ChatApp` のまま別セッションに移るので、作成中の状態（`creatingSession`）は読み込みの effect で戻す。失敗したら入力欄の上のエラー欄に出す。答え合わせの結果画面の「別の会話を始める」も同じ（`RevealView.startNewSession` → `ResultPhase` の `onNewSession`。失敗したらボタンの下にエラー）。新しいセッションを作る処理は SetupScreen・ChatApp・RevealView に同じ形で3つある
- **サイドバーの嘘の件数**: 「作品」欄の「生成された嘘 N件」の行と、セッション一覧の各行の「N件」を削除（答え合わせ済みの印は残した）。スタート画面（`SetupScreen.tsx`）の「続きから」の一覧の「・嘘N件」も削除（`SetupScreen.test.tsx` を新設）。ユーザー向けの画面で嘘の件数を出す所はもう無い。開発者モードのパネルの「嘘」の件数だけは残している（API の `fabricatedFactCount` もそのため残す）
- **としおの「考察」バッジ**: チャット画面（`ChatMessageItem`）と答え合わせの結果画面（`ResultPhase.tsx` の Transcript）の両方から外した
- **話数の表示をやめた**: 答え合わせ画面の見出しは `sessionLabel`（話題の名前）を出す（以前は話題のセッションでも「第0話まで」と出ていた）。`sessionLabel` の「第N話まで」の fallback も削除し、話題も旧データの進捗の入力も無ければ「話題はこれから」。開発者モードのパネルの図（`RevealGraph`）の「第N話〜」は本物の設定が明かされる話数なので残した
- **偽設定の確認画面を廃止**: ヘッダーの「偽設定を確認」、メッセージにカーソルを乗せると出た「設定を確認」、`app/debug/`・`components/debug/`、その画面専用の API（`canon-facts` / `fabricated-facts` / `fabricated-graph`）と client 関数を削除。ChatApp が嘘の一覧を読むのもやめた（`ViewMessage.fabricatedFactIds` は削除。SSE の `metadata` にはまだ載っている）。`store.getFabricatedRelations`・`works.getAllCanonFacts` は本番のコードから呼ばれなくなったが残してある
- **答え合わせの予想画面を廃止**: `RevealView` は開いた時点で `revealSession`（client。`POST .../reveal` に空の guesses）を呼び、いきなり結果を出す。`GuessPhase.tsx` と client の `getReveal` / `submitReveal` を削除。サーバー側（GET の pending・POST の guesses）は変えていない。旧セッションに記録された予想は保存したまま、画面には出さない
- **結果画面を会話だけに**: `ResultPhase` から「話の答え」（主張ごとの本当/嘘のラベル・引用・予想の当たり外れの一覧、`StatementRow`）、「会話をふりかえる」の見出し、嘘の件数の概要（`ResultSummary`。「会話に混ざっていた嘘 N件／確認できる話 M件」と旧セッションの正解数）、本文の印の右上の番号を外した。残るのは凡例 → 印付きの会話 → 戻る/新しい会話のボタン。`verdict.ts` の `VERDICT_LABEL` / `PILL_CLASS` / `outcomeOf` は使われなくなったので削除
- 検証: `npm test` 398件（#37 を取り込んだ後は 392件。#37 で抽出の Gemini 経路のテストが減ったため）・eslint 通過。削除のダイアログは headless Chrome を CDP（`--remote-debugging-port` + Node の WebSocket、スクラッチの `cdp.mjs`）で操作してゴミ箱を押し、見た目・ボタンの実寸・フォーカスを確かめた。`tsc` は `.next/types/validator.ts`（12:52 の古いビルド出力。3000 番の dev サーバーと同じ distDir なので触っていない）が消したページを参照して4件落ちるので、それを除いた設定で通した。スクラッチの `DATA_DIR` と 3004 番で API（削除 → 404、答え合わせ後の送信 → 409、消したページ → 404）を確認し、headless Chrome でチャット画面（ゴミ箱）と答え合わせ画面（予想なしで結果）を目視した

## 2026-09-15: claims 抽出を自前の LoRA 推論サーバ（Qwen3-1.7B）に確定（`feat/local-extract`、PR #37 で dev にマージ済み）

**検証用だった `feat/local-extract` を「これが正」に昇格させた。** claims 抽出は常に自前の LoRA 推論サーバ（`ml/`）で行い、**Gemini の抽出は使わない**。

- **採用モデルは Qwen3-1.7B + LoRA（マージ済み）**。4B は精度は上（厳密F1 0.392 vs 0.267）だが 1件 6秒前後かかり、抽出は1発話ごとに逐次で走るので会話が止まる。1.7B は 1〜2秒。取りこぼした主張は「その嘘が保存されない」だけで矛盾は生まないため、速さを取った。4B に戻すなら `EXTRACT_ENDPOINT` のポートを差し替えるだけ
- このブランチに `feat/reveal-no-explanation`（= origin/dev の取り込み済み）と `feat/lora-extractor`（`ml/` 一式）をマージ済み。**`ml/` がリポジトリに入った**
- `.env.example` / `AGENTS.md` を「`EXTRACT_ENDPOINT` は必須・抽出は `ml/` のサーバ・Gemini は使わない」に統一。`GEMINI_EXTRACT_MODEL` と `client.ts` の `EXTRACTION_MODEL` は消えている
- `ml/README.md` / `ml/HANDOFF.md` の冒頭に採用を明記。既定の起動は 1.7B マージ済み（`$SCRATCH/out/lora/merged`）をポート 8123、4B は別ポート（8124）の比較用
- **PR は `dev` 向き（#37）。依存していた PR #27（`feat/reveal-no-explanation` → dev）は `be08761` でマージ済み**なので、いまの差分は claims 抽出（Gemini 版の削除）と `ml/` 一式だけ
- **2026-09-15: `origin/dev` を再取り込みした**（#27 がマージ前に dev を再取り込みしていて、このブランチはその前の #27 を土台にしていたため衝突していた）。衝突は `.env.example` と `AGENTS.md` の2ファイルだけで、**dev の記述（`GEMINI_API_KEY_2` の2本キー・既定モデル `gemini-3.5-flash-lite`・`fly secrets` 2本）を採り、`GEMINI_EXTRACT_MODEL` は消したまま `EXTRACT_ENDPOINT` 必須の記述を残した**。`client.ts` は自動マージで dev のキー切り替えが入り、`EXTRACTION_MODEL` は消えたまま（下の dev 側の節には「`EXTRACTION_MODEL` を残して自動マージ」とあるが、それは #27 側の記録でこのブランチには当てはまらない）。`extract.ts` / `extract.test.ts` は dev が触っていないのでこのブランチの版がそのまま残った

### 現在つながっている推論サーバ（手元）

リモート GPU サーバ で 2 本立っていて（tmux セッション `serve17` / `serve4b`）、SSH トンネルで手元に同じポート番号で出ている。ドキュメントの既定と同じ配置。

| ポート | モデル | リモートのパス |
|---|---|---|
| 8123 | **1.7B マージ済み（採用）** | `/var/tmp/<user>/chat-lora/out/lora/merged` |
| 8124 | 4B マージ済み（比較用） | `/var/tmp/<user>/chat-lora/out/lora-4b/merged` |

`../chat-local-extract/.env.local` は `EXTRACT_ENDPOINT=http://localhost:8123`（= 1.7B）にしてある。サーバは `setsid nohup` だと SSH 切断で落ちたことがあるので tmux で起動する。

### 通しの確認（3004 の dev サーバ）

`npm install`（`sqlite-vec` など dev 由来の新しい依存が入る）→ `npm run dev -- -p 3004`。セッションを作って「ハチワレってなんで洞窟に住んでるの？」を1発話送り、`GET /api/sessions/<id>/events` の `stage: "extract"` が **`backend: "local"`・claims 6件**（`lives_in / 小さな洞窟` が canon、残り5件が fabricated）で返るところまで確認。`failed` は立たず、待ちも体感で 1〜2秒。

検証: `npm test` 338件 / `tsc --noEmit` / `eslint` / `next build` すべて通過。

## 2026-09-15: claims 抽出をローカルの LoRA 専用にした（worktree `../chat-local-extract` / `feat/local-extract`）

**LoRA 抽出の検証用ブランチ**。`feat/reveal-no-explanation` から分岐。抽出が Gemini に落ちて「動いてしまう」と LoRA の出来が測れないので、**この 1 ブランチだけ Gemini 版の抽出を消して `EXTRACT_ENDPOINT` 必須にしてある**（本流にそのまま持っていくものではない。取り込むなら 2 実装のままの `feat/reveal-no-explanation` 側が正）。

- `lib/server/llm/extract.ts`: `extractViaGemini` とそのプロンプト・構造化出力のスキーマを削除。`extractEndpoint()` は未設定なら**呼び出し時に**例外（起動時には落とさない）。pipeline は既存の try/catch で握り、claims 空のまま返答文は返す
- 推論サーバが落ちている・遅い・形が違うときは `console.warn` 1行 + claims 空（`ExtractResult.failed = true`）。**Gemini へのフォールバックは無い**
- `client.ts` の `EXTRACTION_MODEL` と `GEMINI_EXTRACT_MODEL` を削除。`.env.example` / `AGENTS.md` は `EXTRACT_ENDPOINT` 必須の記述に直した。`ExtractBackend` は `"local"` のみ（イベントの型は他ブランチと揃えて残す）
- テストは Gemini 経路を削除し、失敗系は「warn 1行 + claims 空」を確認するものに置き換え（`npm test` 206件）

### 起動方法

```
cd ../chat-local-extract
npm install                      # node_modules は worktree ごとに要る
cp ../chat-checking/.env.local .env.local
echo 'EXTRACT_ENDPOINT=http://localhost:8123' >> .env.local   # 大学の GPU サーバへの SSH トンネル
nohup npm run dev -- -p 3004 > /tmp/local-extract-dev.log 2>&1 &
```

3000〜3003 は他の worktree が使っていることが多いので空きポートを確認してから。通しの確認は
`POST /api/sessions` → `POST /api/sessions/<id>/messages`、抽出の様子は
`GET /api/sessions/<id>/events`（開発者モードのパネルと同じ SSE）の `stage: "extract"` に
`backend: "local"` が載る。

**推論サーバは初回リクエストが遅い**（コールドスタート。1回目は 10 秒の `EXTRACT_TIMEOUT_MS` を
超えて abort → claims 空になった。温まった後は 7 秒前後で返り、3件の claims が fabricated として
保存されるところまで確認済み）。デモ前に1発叩いて温めること。

## 2026-09-15: claims 抽出のバックエンドを差し替え可能にした（`EXTRACT_ENDPOINT`）

`extractClaims`（`lib/server/llm/extract.ts`）の「モデルに三つ組を出させる」部分だけを 2 実装にした。**`EXTRACT_ENDPOINT` が未設定なら今までどおり Gemini**（flash-lite）、設定されていれば `POST <endpoint>/extract` に投げる（`feat/lora-extractor` ブランチの `ml/serve.py`。FastAPI、`{ text, workTitle, userMessage }` → `{ claims: [...] }`）。

- どちらの経路も `ExtractedClaim[]` を返し、その後の **relation 語彙の検証 → `groundClaims`（canonFacts と照合して grounding を決める）は共通**。語彙外の relation は**その1件だけ**捨てる（`parseExtractedClaims`）。`schemas.ts` の `ExtractedClaimsSchema` は `z.array(z.unknown())` に緩め、1件の逸脱で全件を失わないようにした
- HTTP 版が失敗（接続不可・タイムアウト 10 秒・不正な JSON・非 2xx）したら `console.warn` を1行出して **Gemini にフォールバック**。Gemini も失敗したら従来どおり例外（pipeline が claims 空として握り、会話は止まらない）。**デモ当日に GPU サーバへ繋がらなくても壊れない**
- `extractClaims` の戻り値を `Claim[]` → **`{ claims, backend }`**（`backend: "gemini" | "local"`、実際に使った側）に変更。pipeline がそれを `extract` のイベントに載せ、開発者モードのパネルの extract 段に `2件 / local` のように1語だけ出る
- 実サーバは未接続（GPU で学習中のため）。**テストはすべてモック**（正常系・語彙外の除外・接続失敗/タイムアウト/不正 JSON のフォールバック・未設定時に fetch を呼ばないこと）。ローカルの `http.createServer` を立てた通しの確認だけ手元で1回やって捨てた

## 2026-09-15: claims 抽出の分離 + 嘘のエスカレーション（`feat/claims-extractor` を取り込み済み）

詳細は [docs/handoff-claims-extractor.md](docs/handoff-claims-extractor.md)。generate は返答文（プレーンテキスト）だけを書き、主張の三つ組は `lib/server/llm/extract.ts` が別呼び出しで取り出す。**grounding はモデルではなくコードが決める**（視聴済み canonFacts と subject/object を照合し、一致しなければ fabricated）。セッションの進行度 `SessionPhase`（early/middle/late）で嘘の頻度と密度だけを上げる。閾値の定数は `lib/server/llm/directive.ts` の先頭に集約。

マージ時に消えた挙動: **fabricated な claim の `sourceCanonFactIds` は常に空になった**（canonFact に一致しないものが fabricated なので当然そうなる）。型と `reveal/build.ts`・`graph.ts` の参照はそのまま動くが、構造図の「本物の設定」列は嘘からは繋がらなくなっている。復活させるなら extract 側で「元にした設定」を別に推定する必要がある。

## 2026-09-15: 開発者モードの右パネル（リアルタイム可視化）

デモ・審査向けに「チャットの裏で何が起きているか」をその場で見せる。**チャット画面の右側のパネル**で、ヘッダーの「開発者モード」ボタンで開閉（localStorage に記憶。1024px 未満では出さない）。閉じれば今までのチャットの見た目に戻る。既存の `/debug/[sessionId]` 画面は当時は残したが、`fix/feature-tweaks` で削除した。

- **イベントバス**: `lib/server/events.ts`。セッション ID ごとの in-process な EventEmitter（HMR で切れないよう globalThis に1本）。`lib/server/llm/pipeline.ts` の各段の直後で emit するだけで、**パイプラインのロジックは変えていない**。購読者が居なければ no-op
- **SSE**: `GET /api/sessions/[sessionId]/events`（debug 専用。**チャットの SSE には載せない**）。接続時に `init`（進行度・その段階の上限値・嘘の件数・グラフ）、以降は各段を `stage` として中継、`saved` のときだけ `graph`（描き直した図 + 増えたノード）を足す
- **パネル**: `components/devpanel/`。`DevPanel.tsx`（接続と3セクション）/ `TurnTrace.tsx`（1発話ぶんの段の点灯）/ `trace.ts`（イベント → ターンの純粋関数）/ `useDevMode.ts`（開閉の記憶）
- **グラフ**: 答え合わせの `components/reveal/RevealGraph.tsx` を流用（`compact` と `highlightNodeIds` を足しただけ）。サーバー側は `lib/server/lie-graph.ts` が保存済みの嘘を `buildRevealGraph` に通す。**RevealGraph は答え合わせ画面ではまだ使っていない**が、これでパネルからは使われている
- 進行度の上限値（連続嘘の上限・裏付けの数・としおの間隔）は `directive.ts` の `phaseLimits()` がサーバー側で読んで SSE に載せる（client から `lib/server` の値を import しないため）
- `vitest.config.ts`: `components/**/*.test.ts`（描画を伴わない純粋関数）を node 側のプロジェクトに追加

## 現在の状態（最終更新: 2026-09-15）

- **いまの作業ブランチ: `fix/feature-tweaks`**（上の「画面の整理」節）。以下はそれ以前の記録
- `feat/reveal-no-explanation` は PR #27 で dev にマージ済み（当時の記録: worktree `../chat-checking`、`feat/checking_mockup` から分岐）。答え合わせの結果画面から解説文・根拠・注釈をすべて削った（下記「答え合わせ」節）+ `feat/claims-extractor` をマージ + 開発者モードのパネル + claims 抽出の `EXTRACT_ENDPOINT` 切り替え
- LoRA 一式（`ml/`。合成・学習・評価・推論サーバ）は別ブランチ **`feat/lora-extractor`** にある。本ブランチはそれを**叩く側**だけを持つ（`ml/` は含めていない）
- 親ブランチ: **`feat/checking_mockup`**。答え合わせ機能 + としおの実装（`feat/issue-6-toshio` をマージ済み）+ 全体のリファクタ。**PR は `dev` 向き**で、#8（としお）が先にマージされれば差分は答え合わせとリファクタ分だけになる
- 未マージPR: **#8** `feat: 「としお」の割り込み考察を追加`（`feat/issue-6-toshio` → `dev`）。issue #6 / #10 を閉じる
- `../chat`（`feat/issue-6-toshio` の worktree）には未コミットの差分（`globals.css` / `tailwind.config.ts` / `docs/HANDOFF.md` / `scripts/` / `pictures/toshio.png`）が残っている。こちらの worktree には含めていない
- 検証: `npm test` 212件・`tsc`・`eslint`・`next build` 通過。パイプラインと開発者モードの SSE は **実 API（3002 の dev サーバー）で通しで確認済み**（generate → extract → evaluate → saved → graph → としお まで流れ、嘘が7件まで育つところまで見た）。ブラウザでの見た目の確認だけは未実施（Chrome 拡張が繋がらなかった）
- **2026-09-15: `origin/dev` をこのブランチに取り込んだ**（merge。#18 話題ごとの RAG / #20・#21 ドット絵テーマ / #23 ベクトルDB / #25 嘘を場面の細部に寄せる・としおの作風）。衝突の解消方針は「dev 側の中身、このブランチの構造」。generate は dev の #25 のプロンプトを採りつつ **返答文だけを返す**構造（claims の schema と記録規則は持たない）のまま、pipeline は dev の話題（topic）と履歴クレンジング（`historyForTopic`）の流れに generate → extract → evaluate と phase / directive / イベント emit を重ねた。としおのクールダウンは dev の材料別（質問 2 ターン / 嘘だけ 5 ターン）に進行度を掛け合わせ、late では 0 になる
- **2026-09-15: `origin/dev` を再度取り込んだ**（2回目の merge。#28 issue #26 の上書き誤判定 + issue #11 の API キー2本切り替え / #34 issue #30 としお直後の扱い / #35 issue #32(a) 場面が決まるまで聞き返す / #36 issue #33 見出しの表記ゆれ）。方針は前回と同じ「dev 側の中身、このブランチの構造」。evaluate は dev の `contradictionReason` による判定を採りつつ引数は `claims`（extract 由来）+ 視聴済み canonFacts 全件のまま、directive は dev の `theoryInQuestion`（`analysis` 無し）と `ask_scene` を採ってどの directive にも `phase` を載せる形に揃え、pipeline は `isSceneKnown` のゲートをとしおのクールダウン判定の前に置いた（開発者モードには `skipped: "material"` として出る）。client.ts は dev の2本キー切り替えに `EXTRACTION_MODEL` を残して自動マージ

## 取り込み前の dev 側のセッション記録

- **dev に PR #28・#36・#34・#35 をこの順でマージ済み**（ユーザー指示「マージまでやっていい」）。main への取り込み（`/promote-to-main`）はまだ
  - PR #28（`fix/issue-26`）: issue #26 の上書き誤判定 + issue #11 の API キー2本の切り替え。下の「API キー2本の自動切り替え」「嘘が本物の設定の『上書き』と誤判定される問題」の節
  - PR #36（`fix/issue-33-arc-aliases`、Refs #33。一部）・PR #34（`fix/issue-30-toshio-trigger`、Closes #30）・PR #35（`fix/issue-32-no-topic-canon`、Refs #32。(a) だけ）: 下の「issue #30・#32(a)・#33」の節
  - #35 は #34 の後で `decideDirective` の同じ行（`theoryInQuestion` の引数から `analysis` を外した行と `ask_scene` の追加）が衝突したので、dev を取り込んで解いてからマージした
- 開いたままの issue: #32 の (b)（根拠の id が無い canon の主張の扱い）、#33 の残り（『プリズン』編・『小さな友達』編）、#29・#31（方針未定）、#24、#16、#9
- dev サーバーは 3000〜3003 番をこのツリーで起動中（ユーザー指示。3001〜3003 は `NEXT_DIST_DIR=.next-300X`）。調査・動作確認は 3004 番をスクラッチの `DATA_DIR` で使った（停止済み）

- **作業ブランチ: `feat/vectorDB`**（dev `47d6378` から切った）。issue #22「初回話題特定の RAG にベクトルDBを追加」を実装済み・**未コミット**（コミット・PR はユーザー判断）
- dev には #18（話題の切り替わり・RAG の引き直し）、#20/#21（ドット絵ダークテーマ・字の大きさ）までマージ済み

## 直近のセッション: issue #30・#32(a)・#33（3ブランチ）
- 選び方: 方針が決まっている #30・#32(a) と、制約（作品ごとに別名を足さない）の範囲で汎用に直せる #33 の一部。#29（嘘の回数を縛る案は不採用で方針未定）・#31（方針未定）・#32(b)（方針未定）・#24（本文なし）・#16/#9（調査・大きい機能）は触っていない
- **#30**（`directive.ts` の `theoryInQuestion`）: としおの直後というだけでは「としおの考察への質問」にしない。拾うのは としおの文の引用（従来の `quotesMessage`）・「としお／トシオ」の名指し（いつでも）・としおの直後の「考察」だけ。「考察」をとしおの直後に限ったのは、何ターンも後の「その考察って本当？」まで古い考察に結びつけないため。引数から `analysis` を外した。テストは issue の例文（「怖かったシーンある？」ほか）と、としおの直後の「それ本当？」が layer になること
- **#32(a)**: `directive.isSceneKnown(topic, currentEpisode)`（話題の場面か視聴済み話数のどちらかが分かっている）が false の間は、`decideDirective` が質問の種類を問わず新しい指示 `ask_scene` を返す（`TurnDirective` に追加）。文面は「特定の場面の出来事や細部を語らず、自分で場面を選ばず、どの場面の話か聞き返す」。ペルソナの「聞き返してかまいません」も「聞き返します」+「自分で場面を選んで語り始めない」に強めた。この間は `runToshioInterjection` もとしおを呼ばない（evaluate を通らないため）。実 API（gemini-3.5-flash-lite、generate を直接6回。「泣ける話がしたい」「なんでもいいよ」「ハチワレってかわいいよね」×2）で 6/6 が場面を語らず聞き返し、claims は0件。旧データ（話数を聞いていたセッション）は `currentEpisode > 0` なので従来どおり
  - (b)（`grounding=canon` なのに根拠の id が無い主張の扱い）は方針未定のまま
- **#33**（`topic.ts` の `matchArc` + 新しい `arcNameCore`）: 編の名前の形（『』付きか「編」で終わる）の名前は、飾り（<後>・（擬態型）など）と「編」を除いた芯どうしで比べる。3文字以上の芯が arc の芯の頭と一致しても引く（途中で切れた『シーサーの』編）。小書きの仮名を並字に寄せる（三ッ星／三ツ星）。人物名などの編の形でない名前には芯の照合を使わない（「シーサー」がシーサーの資格編に吸い寄せられ、視聴済み話数を先まで開けるのを防ぐ）。ちいかわの資料の見出し（段落168件のラベル）で前後を比べ、新たに対応したのは『三ッ星』編・『黒い流れ星<前>/<後>』編・『シーサーの』編だけで、既存の対応は変わらない
  - 残り: 『プリズン』編（オデと牢獄編）・『小さな友達』編（カブトムシ編）は呼び方がまるで違い、文字の照合では対応しない。段落の本文で arc の名前を探す案は、『やりたいことリスト』編（シーサーの資格編より前）の本文に「お酒の資格」が出てくるなど、先の arc に対応してネタバレ側に倒れるので採らなかった。やるなら埋め込みでの対応づけ（要計測）か、資料の並び順から「少なくともここまで」の下限を取る案
- 検証: 各ブランチで `npm test`（262〜266件）・`tsc`・`eslint` 通過

## その前: API キー2本の自動切り替え（issue #11、`fix/issue-26` の2つ目のコミット）
- ユーザー指示: issue #11 を「3.5-flash-lite + 無料枠の上限で2人のキーを自動で切り替える」に書き換えて計画をコメントに（済み）→「先輩の API を入力できる場所をつくり、2個使えるように。自分のが切れたら先輩の、先輩のが切れたら自分のに」
- 実装: `lib/server/llm/key-pool.ts`（新規）+ `client.ts`。設計は AGENTS.md「LLM 呼び出しの ON/OFF」節。要点: モデルごとに今のキーを持ち、429 で同じリクエストをもう1本で送り直して以後そちらを使う（元のキーへは、今のキーが切れたときに戻る）。(キー, モデル) 単位で休ませ、1日の上限は quotaId の `PerDay` で見分けて太平洋時間0時まで。無効なキー（400 API_KEY_INVALID / 401 / 403）は外す。状態は `globalThis.__geminiKeyRotation`（キーは sha256 の指紋で識別）。`ai` を包んだので呼び出し側6か所とそのテストのモックは変えていない
- 既定の `GEMINI_MODEL` を `gemini-3.6-flash` → `gemini-3.5-flash-lite` に（issue #11 の合意）。`.env.example` / AGENTS.md を更新。`.env.local` の末尾に空の `GEMINI_API_KEY_2=` を追記した（中身は読んでいない）
- 検証: `npm test` 283件（`key-pool.test.ts` 13件・`client.test.ts` 2件追加）・`tsc`・`eslint`。実 API: 1本目に偽のキー・2本目に本物のキーで `ai.models.generateContent` → 1本目を無効として外し、2本目で応答が返った。**本物の 429 での切り替えは未確認**（本文の形はテストで再現。1分15回を超えて流すか、日次の上限に当たったときにログ `[gemini] ... に切り替えた` を見ること）
- issue #11 のコメントに書いた利用規約の注意（Google APIs 利用規約の「利用上限を回避しない」）は未解決のまま

## その前: 嘘が本物の設定の「上書き」と誤判定される問題（issue #26、`fix/issue-26` の1つ目のコミット）
- 症状:「モモンガ」と打つと、話題は特定できるのに毎回「……そこはちょっとうまく思い出せない。別のところの話、聞かせて。」（evaluate に2回弾かれて `SAFE_UNCERTAIN_MESSAGE`）
- 原因: `evaluate.ts` の `contradictsCanon` が「主語・関係が同じで目的語が違う」だけで上書きとみなしていた（本物の設定の関係が自由記述だった頃の前提）。話題の事実は閉じた語彙なので、「モモンガ did 無茶振り」があると「モモンガ did 尻尾を叩く」のような嘘が全部弾かれる。#25 で嘘が「誰が何をしていたか」（did）に寄ったので、資料係が did で事実を抜いた人物（モモンガ）では毎回起きた。ハチワレ・うさぎは事実が is/has/can なので通っていた。本物の db の嘘35件のうち、話題の事実と主語・関係が重なるものは0件（黙って落とされていた）
- 修正: `claims.ts` に `contradictionReason`（2つの三つ組の矛盾理由）と `isClaimRelation` を切り出し、`findContradiction` と evaluate の本物の設定との照合の両方で使う。本物の設定との照合でも、1つに決まる関係の別の値・肯定と否定・likes/dislikes と can/cannot の反転だけを矛盾とする（否定と反転は以前は本物の設定に対して見ていなかったので、そこは厳しくなった）。関係が自由記述の work.json の canonFacts は照合しない（以前も実質一致しなかった）。差し戻し理由に本物の設定の説明文を入れた
- テスト: `lib/server/llm/evaluate.test.ts`（新規7件。修正前のコードでは4件落ちる）。`npm test` 267件・`tsc`・`eslint` 通過
- 実際に動かして確認（3004 番、スクラッチの `DATA_DIR`）:「モモンガ」3セッションとも差し戻しなしで返事し、保存された嘘（「モモンガ｜did｜尻尾を三回巻き直す」など）は3件とも修正前なら弾かれていた形だった
- issue #26 に書いた別件（未着手）: 15:43〜15:45 の「……ちょっと分からなくなった。」は API キーまわりの一時的な失敗と思われる（`.env.local` の書き換え後は正常）。話題の切り替え直後にシオリが冒頭の問いかけを言い直すことがある。人物の段落からのネタバレ（「でかつよから何かを奪った」）。`components/reveal/ResultPhase.tsx:218` の `data.reveal` undefined の例外

## その前: 話題の特定にベクトルDB（sqlite-vec）を入れる（issue #22、PR #23 で dev にマージ済み）
- ユーザー指示:「issue#22 を実行して。必要に応じて AGENTS.md の方針も書き換えて。ベクトルDBを使うのが優先」。issue の目的は「曖昧なワードを初回の話題特定で拾えるように」、補足は「コンテキストの逼迫に注視」
- 選んだ DB: **sqlite-vec**（`node:sqlite` に拡張として読み込む組み込み型）。`DATA_DIR/vectors/<モデル>-<次元>.sqlite` のファイル1本、作品ごとの partition key、近傍探索も DB 内。サーバーを立てる DB（Chroma・Qdrant・pgvector）はコンテナ1台・Route Handler だけの構成を崩すので外した。AGENTS.md の「意図的に選んでいない技術」を書き換え済み（ベクトルDBは外部資料の段落の検索にだけ使う。db.json は据え置き）
- 変更点:
  - `lib/server/vector-db.ts`（新規）: 接続・表（vec0）・add（既存キーは飛ばす）・removeExcept（記事から消えた段落）・nearest。接続は `globalThis` で共有
  - `lib/server/embeddings.ts`: JSON + メモリの総当たりをやめて DB に出し入れ。関数に `workId` が増えた（`rankChunksByVector(workId, query, chunks, limit)`、`ensureChunkEmbeddings(workId, chunks)`）。**埋め込み済みが1件でもあればその中で探す**（以前は全件揃うまで null）。裏の仕事の Map は `globalThis` で共有
  - `lib/server/topic.ts`: `selectCandidates` を新設。bigram の最高点が3以上なら従来どおり RRF で8段落、**3未満でもコサイン類似度 0.66 以上の段落があればそれだけを資料係に渡す**（以前は bigram 3未満で即「話題なし」）。`prepareTopicSearch` をセッション作成（`app/api/sessions/route.ts`）から呼び、ユーザーが答える前に資料の取得と埋め込みを始める
  - `next.config.mjs`: `serverExternalPackages: ["sqlite-vec"]` と、プラットフォーム別の拡張ファイルを standalone に含める `outputFileTracingIncludes`
  - `Dockerfile`: `node:22-alpine` → **`node:22-bookworm-slim`**（sqlite-vec の Linux 版は glibc 向けで musl では読めない。`vec0.so` の依存で確認）。ユーザー作成は `groupadd`/`useradd` に
- 計測（スクラッチ `bench/after.json`、gemini-embedding-001・768次元、43発話）: 挨拶・相づち15種の最も近い段落は 0.599〜0.646 で、しきい値 0.66 を超えたものは無し。新しく資料係まで届いたのは「泣ける話」「ぞっとしたとこ」「ほっこりするやつ」「牢屋」の4つで、渡る段落は1〜3件（95〜325字。通常の8段落は約1000〜2300字）。それ以外の発話の候補は以前と同じ
- 実際に動かして確認（`.next-build` の standalone を 3011 番で、スクラッチの `DATA_DIR`）: 「泣ける話がしたい」→『あのことでかつよ』編（arc 一致）、「牢屋のとこ」（bigram 0点）→『プリズン』編、「こんにちは」→ 資料係を呼ばない。空の DB から始めてセッション作成 → 8秒後に発話しても、埋め込みの仕事は1本だけで（ルートごとにモジュールが別々に読まれても `globalThis` で共有できている）、80件入った時点で話題が引けた
- 検証: `npm test` 246件・`tsc`・`eslint`・`next build` 通過。**Docker のビルドは未確認**（Docker Desktop が起動していなかった）。デプロイ前に `docker build .` で Debian ベースのイメージと `vec0.so` の読み込みを確かめること
- 注意:
  - ユーザーの dev サーバー（3000番、このツリー）が新しいコードで本物の `.data/vectors/` を作った（168段落、3.3MB）。同じ API キーの埋め込み枠を同時に使うと 429 になる（検証中に1回起きた）
  - 旧キャッシュ `.data/embeddings/*.json` はもう読まない。消してよい（本番のボリュームにも残っているはず）。旧 JSON からの取り込みは作っていない（初回だけ168件を埋め込み直す。約2分、その間は埋め込み済みの分と bigram で検索）
  - しきい値 0.66 は余裕が小さい（相づち最大 0.646 と言い換え最小 0.663）。埋め込みモデルを変えたら測り直すこと
- 残課題・気づいたこと:
  - 『プリズン』編が `work.json` の arc「オデと牢獄編」の別名に無く、arc に対応しない（境界0）。同じ編なら別名に「プリズン」を足すとよい（データの話なので触っていない）
  - 話題の切り替わりのゲート（`topic-shift.ts`）は bigram のままで、曖昧な言い方の切り替えはベクトルでは拾っていない（issue の範囲は初回の話題特定）
  - 挨拶でも話題が決まるまでは検索語の埋め込みを1件使う（以前は bigram で落ちた発話は埋め込みを呼ばなかった）

## 直近のセッション: 嘘の置き場所を「場面の細部」に寄せ、としおの頻度をコードで制御（`feat/pixel-type-scale`）
- ユーザーの相談: シオリの嘘が「ステーキ肉は三回叩く決まり」「裏でキノコ栽培」のような裏話・由来型になり、2周目に見返す気が起きない。としおの出現頻度も想定より高い
- 見立て: `generate.ts` の「意外な裏設定や突飛な由来も歓迎」「補足情報のように述べる」と directive の「新しい設定を1つ」が裏話を誘導していた（例文を消すだけでは変わらなかった）。としおは「シオリの claims が1件でもあれば呼ぶ → 本人の shouldComment は題材があれば true に倒れる」で、実質クールダウン2ターンだけが効いていた
- 変更:
  - `generate.ts`: 嘘のルールを「その場面で起きたこと・映っていた細部（仕草・順番・持ち物・回数）に置く。見返せば確かめたくなること」に書き換え。避けることに「由来・言い伝え・裏設定・決まりごと」「映っている物の見た目・材料・正体を覆す（ゴーヤのステーキ問題）」を追加。例文は型だけ（「最後まで一度も座らなかった」等）。`formatDirective` の introduce も「場面の中の細部を1つ」に
  - `pipeline.ts`: `TOSHIO_COOLDOWN_TURNS`(2) を廃し、`worthAskingToshio(generation, analysis, turnsSince)` に統合。ユーザーが考察・理由を求める／疑う（theory/doubt/fact_question）回は 2 ターン空けば通し、シオリが嘘をついただけの回は 5 ターン空かないと通さない（`TOSHIO_COOLDOWN_ON_QUESTION` / `TOSHIO_COOLDOWN_ON_CLAIMS`）
  - `toshio.ts`: ユーザーの方針は「岡田斗司夫風。シオリの細部を証拠に、胡散臭いがそれっぽい根本の深い考察（スネイプは実は味方、のような反転や都市伝説）」。最初に入れた「見返すならここに注目」型は弱いと言われ撤回。代わりに「細部を証拠に根本へ潜る。批評用語で言い換えただけの一般論は避け『本当は〇〇だった』と言い切る」とし、**切り口 `THEORY_ANGLES`（反転・隠れた因果・伏線・第三者・都市伝説・本音と建前・世界の裏側）をコードがランダムに1つ選んでプロンプトに渡す**（`pickTheoryAngle`、`angle` 引数で固定可）。ペルソナの「評価経済的視点」は労働・階級の読みに毎回落ちる原因だったので外した
- 実 API（gemini-3.5-flash-lite、同じ発話「シーサーがくりまんじゅうにステーキをあげる話」で generate 5回）: 5/5 が場面の細部の嘘（「渡す直前に小さくお辞儀」「メモを皿の下に敷いた」「グラスを端へ動かした」）で relation は did。裏話・由来型は 0。としおは切り口なしだと3/3が「忠誠の儀式・契約」の同じ読み。切り口を渡すと「お辞儀は客の主導権を奪う無言の圧力（反転）」「店主への合図（第三者）」「師匠を奪う宣戦布告（本音と建前）」と分かれたが、この話題（師事・資格）では主従・階級の語がまだ多い
- **作風を土台にする**（ユーザー提案: 岡田斗司夫は作者の作風評価から考察を深める）。IP 非依存にするため、`work.json` に `creators`（役割・名前・本人の Wikipedia 記事名）だけ要求し、作風の要点は `lib/server/creator.ts` → `llm/creator.ts`（資料係）が記事から1回抜いて `DATA_DIR/creators/<workId>.json` にキャッシュする。`style` を手書きすれば記事は読まない。実在の人物なので抜くのは作風だけ・としおにも「発言・私生活・制作の裏話を作らない」を明記。`sources.loadChunksOfSource` を公開して作り手の記事にも使う。`pipeline.runToshioInterjection` が `getCreatorProfiles` を呼び、失敗しても作風なしで割り込む
  - 実 API: ちいかわの原作者記事（「ナガノ (イラストレーター)」の概要・人物）から「柔らかな線画」「可愛い絵柄で不条理や狂気」「食感の擬音」の3行が抜けた。としおは「ナガノ作品の柔らかい線画は重要な瞬間を静かに描くから、あのお辞儀は伏線」のように作風を根拠に使う。ただし読みはまだ「労働・儀式・契約」に寄る（話題自体が師事・資格で、`work.description` も「労働と資格で成り立つ世界」なので引っ張られている）。別の場面での確認が必要
  - 本番の `.data/creators/` はまだ無い（実験は scratch の DATA_DIR）。アプリで最初にとしおが出るときに1回 API を呼ぶ
- **としおとの話をシオリに組み込む**（ユーザー報告: としおの考察を「これ本当？」と聞いてもシオリが自分の嘘に細部を足すだけ）。原因は `generate.toGeminiContents` がとしおの発話を履歴から完全に落としていたこと（AGENTS.md の「【としお】の印」は dev 統合時に消えていた）。ユーザー判断で「としお本人が答える」ではなく **シオリが追加の嘘で整合を取る** 方式にした
  - `directive.ts`: `theoryInQuestion`（としおの直後の発話で感想以外／としおの文の引用 = bigram の重なり 0.6 以上）→ 新しい directive `support_theory { theory }`。doubt の layer より優先。`decideDirective` に `userMessage` を渡す
  - `generate.ts`: 履歴のとしおは直近1件だけ `【としお】` 付き・300字で model 側に載せる。ペルソナに「としお」節（否定も肯定もしない・口調を真似ない）。`formatDirective` の support_theory は「考察が成り立つように見える場面の細部を1つ、自分が見たこととして足す」
  - 実 API（報告どおりの会話を再現）: 「そうなの？」→ support_theory →「合格証を拾ったとき、ちいかわはハンカチで拭いていた」（やや弱い）。としおの文を引用した「これ本当？」→「としおがどう思ったのかは知らないけど、拾ったあとちいかわと目を合わせないようにすぐポケットへしまい込んでいた」（罪悪感の考察をきれいに支えている）
  - としおは主張を記録しないまま。答え合わせにも変更なし
- 気になる点（未対応）: 5回とも「ステーキを渡す直前に〜」で始まり、置き場所が単調。ユーザーが疑ったときの `layer` 指示は「裏付ける細部を足す」のままで、裏話型に戻る余地がある
- 検証: `npm test` 245件・`tsc`・`eslint` 通過

## 直近のセッション: 字の大きさと本文幅の調整（`feat/pixel-type-scale`、PR → dev）
- ユーザー要望:「この雰囲気だと字がもう少し大きいほうが分かりやすい」「PC ではもう少し広く」「入力欄の下がぐちゃぐちゃなので整理」「シオリ・オンラインを削除」
- ドットのラベル（`font-pixel`）は **16px 固定**（DotGothic16 のグリッド。縮小するとつぶれる）。本文・入力欄は 17px / 行間 1.7。一覧の題名は 15px。本文幅は 860px
- スタート画面も同じ調整（幅 640px、見出し 36px、説明 16px、作品カードの本文 15px、ボタン 18px、シオリの絵 160px）
- 入力欄の下は、注意書き（13px）と送信のショートカット（ドット）の 1 行だけにし、「シオリ・オンライン」の表示は削除
- 検証: tsc・eslint・`npm test` 231 件・ヘッドレス Chromium で 1440px 幅の目視

## 直近のセッション: ダーク前提の「ドット絵風」テーマ（`feat/issue-15`、**未コミット**）
- ユーザー要望:「ダークモードを、色調は変えずに Inverted Angel 風のドット絵の少しおしゃれな感じに。文字まで全部ピクセル風は厳しいのでバランスを考えて」→「一旦ダーク前提で」
- 決めたバランス: **絵・枠・小さなラベルはドット、本文は普通**。本文・入力欄は Noto Sans JP のまま。話者名・時刻・「作品/セッション」の見出し・バッジ・ボタンのラベルだけ DotGothic16（`font-pixel`、next/font の `--font-pixel`）。CRT・走査線の湾曲は入れない（背景は 3px 間隔の縦のディザを 2% 弱で敷くだけ）
- 仕組み:
  - 色は `app/globals.css` の CSS 変数（`--c-*`、"r g b" 三つ組）に移し、`tailwind.config.ts` は `rgb(var(--c-x) / <alpha-value>)` で参照する。**既定（`:root`）がダーク**。元のライトの値は `[data-theme="light"]` に残してあり、`app/layout.tsx` の `<html data-theme="dark">` を切り替えれば戻る（切り替え UI は無い）。色相は元のラベンダー系のまま明度だけ反転、primary はダーク地で沈むので少し明るく（#7b63d6 / active #8f7ae0）
  - 角丸トークン（`rounded-md` 等）は `--radius-*` 変数にして、ダークでは全部 0。ライトでは元の値
  - `.pixel-frame`（2px 線 + 四隅を 2px 欠く clip-path。外側の影やフォーカスリングは出せない）、`.pixel-btn`（ぼかしなしの 2px 落ち影、押すと沈む）、`.pixel-dither`（2×2 ディザの地）を `@layer components` に置いた
  - `Mascot` は丸抜きをやめて `pixel-frame` の正方形 + `img[data-pixel]` で `image-rendering: pixelated`
  - fade-up / typing-dot は `steps()` に変え、ストリーミング中のカーソルは `█` 状のブロック（`animate-blink`）。アイコンは `strokeLinecap: square` + `crispEdges`
  - 触ったコンポーネント: chat/{ChatApp,ChatHeader,ChatInput,ChatMessageItem,Sidebar,TypingIndicator}, setup/SetupScreen, ui/{Mascot,icons}。reveal / debug はトークン経由で暗くなるだけで className は触っていない
- 検証: `tsc`・`eslint`・`npm test` 229件 通過。ヘッドレス Chromium（Playwright のキャッシュの chrome-headless-shell）で 3001 番の dev サーバーをスクリーンショットして、セットアップ・チャット（ユーザー吹き出し・としお）・答え合わせ（予想）を目視確認。`next build` は dev サーバーと衝突するので未実行
- 注意: このツリーの dev サーバーは **3001 番**（別セッションが起動、PID は `.next/dev/logs`）。3000 番は別ディレクトリ `../chat-app` の古いコードなので見ないこと。Chrome 拡張（claude-in-chrome）は接続できなかった
- **dev との統合**: dev には先に PR #17（ライト/ダーク切り替え、`--color-*` 変数、`ThemeToggle`、FOUC 防止スクリプト）が入っていたが、ユーザー判断でこのドット絵ダーク版を正として上書きした（globals.css / layout.tsx / tailwind.config.ts / chat・setup・ui の各コンポーネントはこちらの版）。`components/ui/ThemeToggle.tsx`（+test）と `SunIcon`/`MoonIcon` は残っているが**どこからも使っていない**。ライト切り替えを戻すなら `[data-theme="light"]` の変数はあるので、トグルを付け直すだけでよい
- 残課題: 答え合わせ・debug 画面のカードにも `pixel-frame` を当てるか（今は角が直角になっただけ）。ライトへの切り替え UI は未着手。`tsconfig.json` の差分（`.next-3003` の include）はこのセッション以前からのもので触っていない

## 調査メモ: 「ステーキはゴーヤでできている」のような見れば分かる嘘は RAG 化のせいか（コードは変えていない）
- ユーザー質問: localhost:3000 の会話（セッション `24d7e2dc`、話題「シーサー」）で出た「ステーキはシーサーが山で野生のゴーヤを素手で捕まえて作った」は RAG 化で出やすくなったのか、元々出うるのか
- 結論: **元々出うる嘘**。RAG 化で増えた証拠はない。`88765bb`（RAG 前）と `6e8c28f`（RAG 後）を worktree で並べ、同じ発話で generate を直接呼んで比べた（gemini-3.5-flash-lite、各条件10回、スクラッチの `liebench.test.ts` / `results-*.jsonl`。リポジトリには入れていない）。RAG 前は話数を知っている状態（255話・63話）+ work.json の canonFacts、RAG 後は保存済みの topic をそのまま使った
  - ステーキの場面: 「ステーキが実は肉ではない」系は RAG 前 2〜3/10（修業用の硬い植物・虫の背中を揚げ焼き・島豆腐の代わり）、RAG 後 2/10（サボテン・島豆腐を焼き締めた）。沖縄つながりの食べ物（島豆腐・黒糖・島バナナ・サーターアンダギー）は両方で出る（RAG 前は「沖縄の文化を思わせる話し方」、RAG 後は「シーサーがモチーフ」から連想している）
  - 草むしり検定の場面: 「ノートのページが夜中に勝手に増える」系の超常的な嘘は RAG 前 5/10、RAG 後 1〜2/10。RAG 後は topic の事実（内緒で勉強・ハチワレだけ合格）に乗った「内緒にしたのは驚かせたかったから」のような動機の嘘が出た。本番の db にも RAG 前（09-14 13:17）の「勉強のノートは夜中にページが勝手に増えていく」が残っている
- 原因の見立て: RAG ではなく generate のペルソナ（`generate.ts` の「発想は自由でよく、意外な裏設定や突飛な由来も歓迎する」。`5f025c6` で RAG より前に追加）。ゴーヤの嘘も relation=origin（由来）。場面の材料が少ないと、場面にある物（ステーキ・ノート・鉄板）の正体や由来に嘘を置き、画面に映っている見た目を覆してしまう。モデルは画面を知らないので、「視聴済み範囲と明白に矛盾しない」は抑えにならない。evaluate は矛盾以外で嘘を棄却しない設計なので素通りする。3.6-flash との比較は日次枠が少ないので試していない
- 直すなら（未着手・ユーザー判断待ち）: 嘘は画面に映らない部分（動機・裏事情・画面外の出来事）に置き、映っている物の見た目・材料・起きたことは覆さない、とペルソナに書く
- 注意: この調査の間、別のセッションが同じ作業ツリーで話題の切り替え（`topic-shift.ts` / `router.ts` / `embeddings.ts` など、未コミット）を進めていて、3007 番の dev サーバーも立てていた。実験の API 呼び出しと重なって 429 が何件か出たので、間隔を空けて補った

## 直近のセッション: 話題の切り替わりで RAG を引き直す（`feat/session_rag`、**未コミット**）
- ユーザー要望:「文脈の切り替え（Topic Shift / Intent Change）を判定した時だけ動的に RAG を再呼び出ししたい。Tool Calling か判定用の軽量モデルかは現状を踏まえて判断。同一 API のコンテキスト圧迫に注意。会話履歴のクレンジング・検索クエリの再構築を検討。圧迫が起きないならベクトル検索も検討」
- 判断: **決定的なゲート + 軽量モデルの判定役**。Tool Calling は 3.5-flash-lite で構造化出力と併用でき、実際にツールを呼んだが、呼ぶ回はシオリの全文脈（約2Kトークン、countTokens で実測）を2往復送り直し、生の段落（上位8件で約1.4K）がシオリの文脈に積まれるので不採用。判定役は約440トークン・別モデル
- 設計の詳細は AGENTS.md「話題の場面」節の「話題の切り替わり」。要点: `lib/server/topic-shift.ts`（ゲート: 切り替えの言い回し / 別の arc / いまの話題の外の段落への強い重なり → 判定役 `llm/router.ts` が切り替えか・検索語を返す）→ `pipeline.ts` が組み直した検索語で `lookupSessionTopic` を引き直す → 新しい話題に `since` を付け、`historyForTopic` がそれより前の履歴をシオリに渡さない（前の話題は名前だけ `# ここまでに話した話題` に入れる）。前の話題は `ChatSession.pastTopics` に移し、その事実は evaluate・答え合わせ・debug では引ける。事実の id は `topic-<何番目の話題>-<連番>`
- ベクトル検索: `lib/server/embeddings.ts`（`gemini-embedding-001`、768次元）。bigram と RRF で混ぜる（`sources.fuseRankings`）。実データで「みんなで大きい敵を倒しにいく話」→『おっきい討伐』編（bigram では圏外）、「オデと牢屋から逃げる話」→『プリズン』編が1位になった。**埋め込みの無料枠は1分100件で、まとめて送っても1件ずつ数える**ので、段落は裏で80件ずつ1分おきに埋め込み（段落168件で約2分）、`DATA_DIR/embeddings/*.json`（約1.1MB）に残す。揃うまでは bigram だけ。`gemini-embedding-2` は複数入力を1本のベクトルに束ねるので使えない
- **無料枠の注意**: flash-lite は1モデルあたり1分15回。判定役の既定を当初 `gemini-3.5-flash-lite`（= `.env.local` の GEMINI_MODEL）にしていたら、シオリと枠を食い合って 429 になった。既定を `gemini-3.1-flash-lite` に変えた（`GEMINI_ROUTER_MODEL` で変更可）。`.env.example` に `GEMINI_ROUTER_MODEL` / `GEMINI_EMBEDDING_MODEL` を追記
- 実 API での確認（スクラッチ `DATA_DIR` の 3007 番。停止済み）: 「草むしりの鎧さんってどんな人？」はゲートを通ったが判定役が「続き」。「そういえばハチワレのリボンが鳥に持っていかれる話も好き」は判定役が検索語「ほめられリボン 鳥にさらわれる」を作って話題が切り替わり、それまで繰り返していた嘘（雑草の鉛筆）が切り替え後の返答から消えた。「みんなで大きい敵を倒しにいく話ってあったよね」はゲートを通らず取りこぼしたので、言い回しのパターンを足した（未再検証。ゲートのテストでは通る）
- ゲートの誤検知: 実会話の同じ話題の発話 28件中5件（約2割）が通る（判定役を1回呼ぶだけ）。本当の切り替え6件はすべて通った
- サーバーログに `[topic-shift] <理由>:<詳細> → 続き / 切り替え「検索語」` を判定役を呼んだ回だけ出す
- テスト: `topic-shift.test.ts`, `llm/router.test.ts`, `embeddings.test.ts` を新規。pipeline.topic（切り替え・クレンジング）、topic（検索語・話題番号・融合）、store.topic（pastTopics への移動）、sources（RRF）、generate（前の話題）、messages route を追記・更新。`npm test` 210件・lint・build 通過
- 残課題: 判定役・資料係の出来は LLM 任せ。切り替え直後の1往復は判定役+資料係+generate(+としお) で、generate のモデルに2〜3回かかる（1分15回の枠では連投すると 429 になりうる）

## 調査メモ: シオリの嘘の割合（コードは変えていない）
- ユーザー質問:「シオリはおよそ何割嘘をつく？短い会話・長い会話で傾向は？」。gemini-3.5-flash-lite で、スクラッチ `DATA_DIR` の 3007 番サーバーに台本で流した（短い会話3往復×6本・長い会話14往復×2本、計46返答、エラー0）。スクリプトと結果はセッションのスクラッチ（`liebench/`）にあり、リポジトリには入れていない
- 結果（claims の grounding による自己申告）: 嘘を含む返答 74%、設定上の主張の 46% が作り話。strategy は introduce 37% / reinforce 39% / no_new_lie 20% / admit_uncertainty 4%（プロンプトの目安は新しい嘘30〜50%・再利用20〜30%で、再利用が多すぎ、普通の会話が少なめ）。1往復目だけ 50%（話題の場面の紹介で本当のことを言いがち）、2往復目以降は 63〜88% で、長さによる増減ははっきりしない（各区分6〜16返答で少ない）
- 長い会話の傾向: **同じ嘘への固執**（ユーザー判断で当面は放置）。ハチワレの会話では「森の奥で木の実を独り占め」が最初の8返答のうち6回、検定の会話では「特製の草むしりフォーク」が最初の7返答すべてに出て、ギター・歌・カメラなど関係ない質問にもねじ込まれた。言い換えは同じ嘘として統合されないので、保存された嘘の数（14件）は実際の嘘の種類（7〜8）より多い
- 事実の誤りを canon として記録した例: 「ハチワレのしっぽは体と同じ色」（本当は青）、「試験の前日に三人で一緒に勉強した」（本物の設定ではハチワレは内緒で勉強）。自己申告の取りこぼしは46返答中数件で、割合の数字を大きく変えるほどではない
- 疑われたとき: 「それ本当？」に半分引っ込めた例（「描かれていなかったかもしれない。でも…確かだよ」）と、押し通した例が1つずつ
- 再生成 6/46（13%）、うち2回は定型の濁し返答（「……そこはちょっとうまく思い出せない」）

## 直近のセッション: 日本語入力の変換確定の Enter で送信されるバグの修正（`feat/session_rag`、コミット済み）
- `components/ChatInput.tsx` の `handleKeyDown` で、`e.nativeEvent.isComposing` か `e.keyCode === 229` のときは何もしないようにした（Safari は確定の keydown で isComposing が false になり、keyCode 229 で来るため両方見る）
- テスト: `components/ChatInput.test.tsx`（新規6件）。`npm test` 170件・lint 通過
- このセッションで localhost:3000 の dev サーバーを再起動した（別セッションが起動していたものを止め、このセッションのバックグラウンドで `npm run dev -- -p 3000`）

## その前: issue #14 シーン検索を廃止し、セッションごとの RAG にする（`feat/session_rag`、コミット済み）
- ユーザー指示:「issue#14 を作業して。スタート画面は後で作るから、まずは RAG 化を進めて」。一度「キリがいいとこで止めて」で中断し、「作業を再開して」で続きをやった。ユーザー指示で「feat: スタート時におけるllmのRAG化」としてコミットし、プッシュした（PR はユーザー指示で作らない）
- **外部の知識源は Wikipedia（MediaWiki API）**。Gemini の Google 検索グラウンディング（`tools: [{googleSearch:{}}]`）は今の無料キーだと 3.5-flash-lite / 3.6-flash / flash-latest すべて **429**（グラウンディングなしの同じ呼び出しは通る）、`urlContext` は 500 だったので見送った。課金を有効にすれば検索グラウンディングに切り替える余地はある
- 流れ: セッション作成は `workId` だけ（話数は聞かない）→ シオリの定型「……今日は何について話したい?」→ ユーザーの最初の答えで `lib/server/topic.ts` の `lookupSessionTopic` が走る:
  1. `lib/server/sources.ts`: `work.json` の `sources`（今は `ja.wikipedia.org` の「ちいかわ なんか小さくてかわいいやつ」）を TextExtracts で取り、段落に区切る（`chunkArticle`。『〇〇』編やキャラ名の短い行を段落の見出しにする。プロセス内に6時間キャッシュ）。発話との**文字 bigram の IDF 重み付き重なり**で順位付け（`rankChunks`。ひらがなだけの bigram は軽く、entities の正式名は重く、段落長で割り引き）。ベクトルDBは使っていない（AGENTS.md の方針どおり）
  2. 点数 3 以上の上位8段落を `lib/server/llm/topic.ts` の `extractTopic`（資料係。Gemini 1回、構造化出力）に渡し、場面の title/summary と事実（閉じた語彙の relation で三つ組）を抜かせる。渡していない段落 id を根拠にした事実は捨てる
  3. title や段落見出しを `arcs` の名前・別名と照合し（`matchArc`）、合えば `currentEpisode` = その arc の `episodeTo`、事実の `episodeFrom` = arc の `episodeFrom`。合わなければ境界は 0 のまま、事実は `episodeFrom: 0`（話数に関係なく見せる）
- 結果は `ChatSession.topic`（`SessionTopic`）に保存（`store.setSessionTopic`。一度決まったら差し替えない・境界は広げる方向のみ）。**話題が決まるまでは発話のたびに調べ、決まったら以後は外部を引かない**（1セッションあたり Gemini +1回）。挨拶など点数の低い発話では資料係を呼ばない
- `ChatSession.currentEpisode` の意味が変わった: 「話題にした場面から分かる、少なくともここまでは見ている話数」。新規セッションは 0（work.json の canonFacts は話数では何も見せない）
- 話題の事実は `topic-1..n` の id の CanonFact として、retrieval（常に先頭）/ generate / evaluate（`allCanonFacts` にも足す）/ としお / 答え合わせの根拠 / debug 画面に流れる（`retrieval.getVisibleCanonFacts`）。プロンプトには「# 今日の話題」と、境界 0 のとき「どこまで見たかは分からない。今日の話題の場面より先の展開には触れない」を入れる（`llm/context.ts`）。シオリのペルソナに「話題が決まっていなければ短く聞き返してよい」を追記
- SSE に `topic` イベント（シオリの吹き出しより前）を追加。ChatApp はヘッダーの見出しを更新する。見出しは `lib/client/types.ts` の `sessionLabel`（話題 → 旧データの `progressDescription` → 第N話まで → 「話題はこれから」）に統一。話数0の設定は `episodeFromLabel` で「今日の話題」と出す
- 再開後に追加: `work.json` の `sources[].sections` で使う章を絞れるようにした（chiikawa は 概要/世界観/連作エピソード/登場キャラクター/用語。コラボ・ショップ・スタッフ・劇場版の章を外して段落 246→168）。資料係のプロンプトに「場面そのものの段落を優先し、用語・人物の段落は補足に使う」「続編・後日談は facts にも summary にも入れない」を追加。AGENTS.md に「話題の場面（セッションごとの RAG）」節を足し、シーン検索の記述を置き換えた
- 削除: `lib/server/progress-resolver.ts`、`/api/works/[workId]/resolve-progress`、`resolveProgress`、`Progress*` 型、未使用だった PATCH `/api/sessions/[id]` と `updateEpisode` / `updateSessionEpisode`、`works.getAllEpisodes`。SetupScreen は作品カード +「シオリと話す」ボタン +「続きから」だけの仮の形（**スタート画面の本デザインはユーザーが後で作る**）
- ついでの修正: 冒頭の問いかけにも空の claims を保存するようにした（以前は全セッションの答え合わせで「記録前の旧データあり」扱いになっていた）
- テスト: `sources.test.ts`, `topic.test.ts`, `llm/topic.test.ts`, `llm/pipeline.topic.test.ts`, `store.topic.test.ts`, `app/api/sessions/route.test.ts` を新規、既存の messages route / pipeline.toshio / generate / ChatApp / store.reveal を更新。`npm test` 164件・lint・build 通過
- 実 API での確認（`DATA_DIR` をスクラッチに向けた 3007 番の dev サーバー。停止済み）: 「草むしり検定のところの話がしたい」→ 話題「草むしり検定」・arc 一致で境界63、シオリが話題に乗って小さな嘘、としおも割り込み。「ハチワレが好き」→ 人物の話題（arc なし・境界0）で基本設定7件。「こんにちは」→ 資料係を呼ばず話題なし、シオリが聞き返す。再開後の改善版では「ラーメン屋に入れなかったとこ」→『郎』編（初めての郎編, 境界43）、「草むしり検定のところ」→『草むしり検定』編で、事実はその場面のものだけ（再挑戦などの後の展開は混ざらなかった）
- **残課題**:
  - 資料係が後の展開を事実に混ぜないかは LLM 任せ（決定的な検査は無い）。最初の版では混ざり、プロンプト改善後の実行では混ざらなかった。人物の話題（Wikipedia の登場人物節）には後の話のネタバレが多い
  - bigram 検索は言い換えに弱い（『郎』編は8候補中5位でぎりぎり入る）。「うさぎがすき」は『すき焼きキャンペーン』編とうさぎの段落が同点付近で、資料係の判断に頼っている
  - 会話の途中で話題が変わっても外部は引き直さない（初回の仕組みとして意図的にそうした）。必要なら「analyze で新しい arc を検出したら追加で引く」などを検討
  - generate が `usedExistingFactIds` に canon の id（`topic-1` 等）を入れることがあり、metadata の `fabricatedFactIds` に混ざる（以前から canon id でも起こりうる既存の挙動）
- 後片付けメモ: ビルド確認のため、古いビルド生成物 `.next-3001/` と `.next/types/`（削除済みの resolve-progress を参照していて型検査が落ちていた）を消した。どちらも gitignore の生成物で再生成される。`next build`/`next dev` が別 distDir で起動すると `tsconfig.json` の include を書き換えるので、毎回 `git checkout tsconfig.json` で戻している

## その前のセッション: 答え合わせに「嘘の構造図」を追加（`feat/checking_mockup`、未コミット）
- ユーザー要望:「答え合わせ画面で、嘘の論理関係をグラフなどで構造化して表示し、華やかにしてほしい」
- 作業は `feat/issue-6-toshio` と並行するため **git worktree `../chat-checking`** で行った（`git worktree list` で見える）。変更は worktree 内に未コミットで置いてある。コミット・PR はユーザー判断
- サーバー: `lib/server/reveal-graph.ts`（新規）の `buildRevealGraph` が、答え合わせ後の `RevealData.graph`（`RevealGraph` 型、`types.ts`）を作る。ノードは 主張(statement: 本当/嘘・番号) / 主語や目的語のキャラ・物(entity: `buildNormalizer` で別名を正式名に寄せる) / 嘘が元にした本物の設定(canon) / 嘘に乗ったとしお(toshio)。辺は subject（関係の語をラベルに）/ object（目的語が登場人物か他の主張の主語のときだけ）/ based_on / rode_on。**推測は入れず、記録から機械的に引ける関係だけ**。`FabricatedRelation` はどこからも書かれていないので使っていない
- そのために `RevealStatement` に `subject/relation/object/negated` を追加し、`sources` に `id` を足した。`toRevealData` は第3引数で `entities` を受け取り、Route Handler が `getEntities(workId)` を渡す
- クライアント: `lib/client/graph-layout.ts` が乱数なしの力学レイアウト（種類ごとの同心円から開始、反発+ばね+中心引力を320回）。`components/RevealGraph.tsx` が inline SVG で描く（ライブラリ追加なし。Tailwind の `fill-*`/`stroke-*` で色付け）。hover で隣接だけ強調、主張・としおのノードを押すと `#statement-<id>` / `#message-<id>` へスクロール（`RevealView` の該当要素に id を付けた）。主張が0件なら図は出さない
- テスト: `reveal-graph.test.ts`, `graph-layout.test.ts`, `RevealView.test.tsx` に2件追加、既存の reveal/route テストを新しい statement の形に更新。`npm test` 111件・lint・tsc・build 通過
- 見た目は headless Chrome（Chrome 拡張が未接続だったため `--headless=new --screenshot`）でスクラッチ `DATA_DIR` のデモセッション（3007番）を撮って確認した。最初は `fill-opacity-[…]` が Tailwind に無く丸が塗りつぶしになっていたので `fill-error/15` 形式に直し、ノード間隔も広げた
- 残る改善余地: ラベルどうしの重なりはまだ起きうる（ラベル幅を考慮した反発は入れていない）。としおの発話は claims を持たないため、としお→嘘の辺は「直前のシオリの嘘」で近似している

## リファクタ（2026-09-15）で変えたこと

振る舞いは変えていない。並びとファイル名だけ。

- `components/` を画面単位に分割: `chat/` `reveal/` `setup/` `debug/` と共有の `ui/`（Mascot, icons）
- `RevealView.tsx` を `RevealView`（読み込みと予想/結果の切り替え）/ `GuessPhase` / `ResultPhase` / `verdict.ts`（本当/嘘の表示ルール）に分割
- 答え合わせのサーバー側は `lib/server/reveal/`（`build.ts` 発話の区切り、`graph.ts` 嘘の構造図、`types.ts` 答え合わせ専用の型）。`lib/server/types.ts` からは reveal の型を抜いた
- SSE の書き込み口を `lib/server/sse.ts` に切り出し、messages の Route Handler はパイプライン呼び出しと保存だけ
- `lib/client/format.ts`（formatTime）を `lib/client/types.ts` から分離
- テスト名を対象に揃えた（`store.test.ts`、`pipeline.test.ts` にとしおのゲーティング純粋関数のテストも統合）
- 二重化していた `docs/HANDOFF.md` を削除（正は直下の `HANDOFF.md`）。`.agents/skills/*` は `.claude/skills/*` への参照だけにした（内容が古くなっていた）。`tsconfig.json` に混入していた `.next-3001` の include を除去

## いま効いている設計判断（AGENTS.md に無いもの）

### 生成: 「量と頻度はコード、中身は LLM」
- `lib/server/llm/directive.ts`（純粋関数）が毎ターンの指示を決める。順に: `doubt` → **layer**（疑われた嘘を撤回せず裏付けの細部を1つ足す）／直近 `LIE_STREAK_LIMIT`=2 件連続で嘘を保存していれば **plain**／`impression`・`other` で言及キャラも出来事も無ければ **plain**／それ以外 **introduce**
- 生成は1回の構造化出力（返答文 + claims）。`strategy` はモデルに選ばせず、保存結果から事後に決める（UI バッジととしおのゲーティング用）
- **ネタバレ防止は全廃**（ユーザー方針。疑われたら嘘を重ねる制御を優先）。evaluate に残る検査は「既存の嘘との矛盾」「fabricated claim による本物の設定の直接上書き」の2つだけ。ただし `retrieveCanonFacts` が視聴話数以下しか返さない仕組み（`getCanonFactsUpTo`）は残してあり、外すかはユーザー判断待ち
- 経緯: 長いセッションでシオリが嘘をやめる問題（プロンプトの「絶対に矛盾させるな・全件記録・quote は一字一句」が自己監視を招いた）への対処。extract 方式（返答と主張の分解を別呼び出しにする、1発話2回）も試したが「疑われると引っ込める」ので不採用

### claims の `quote`
- 答え合わせが本文中の位置を出すのに使う。`generate.ts` の responseSchema には**あるが必須ではない**（必須にすると上の自己監視問題に戻る）。無ければ答え合わせは「位置不明」として末尾に並べる

### としお
- `toshio.ts` は「題材（premises）」方式: そのターンの fabricated claims を本作の事実として渡し、乗って考察を重ねさせる。`markLies`（【嘘】印で位置を教える方式）は廃止済み
- 割り込みはシオリのストリームを流し切って保存した後（`runToshioInterjection`）。直近2ターン以内に割り込んでいれば見送り、`admit_uncertainty` の返答には乗せない
- としおの発言は `FabricatedFact` 化されておらず、答え合わせでも一文ごとの真偽は出さない。どの嘘に乗ったか（`premiseStatementIds`）はデータには残っているが、結果画面には出さない

### 答え合わせ
- 設計は AGENTS.md「答え合わせ」節。結果画面の配置は「概要（件数だけ）→ 発言順の答え → 真偽をマークした会話」、幅 800px 1カラム
- **結果画面は差分のハイライトだけ。解説文・根拠・注釈は出さない**（ユーザー判断。理由は「アニメを見ればわかる」ので不親切でよい）。`ResultPhase.tsx` から削ったもの: 各行の「根拠: …」「元にした本物の設定: …」「この会話で作られた設定です。」「本文中の位置は特定できませんでした」、凡例の「印のない部分は、真偽を判定していません」「記録を始める前のシオリの発話は…」、としおの注記（ToshioNote 全体。としおの発言は本文だけ出す）、「答え合わせできる話は記録されていません。」、「会話に出てきた順に…」、構造図の details。**「〜は判定していません」の類の一言を足し直さないこと**
- 予想フェーズ（`GuessPhase`）は変えていない。本文の印・番号・「話の答え」リストの行（ラベル + 引用文 + 予想の結果ピル）・凡例の「嘘 / 本当」2つは残っている
- 構造図（`components/reveal/RevealGraph.tsx` + `lib/client/graph-layout.ts` + `lib/server/reveal/graph.ts`）は結果画面から外しただけで、コードもテストも API の `graph` フィールドも残してある。**答え合わせの結果画面からは描画していない**（開発者モードのパネルが `compact` で使っている）。結果画面に復活させるなら `RevealGraph` を import し、飛び先の `id`（`statementAnchorId` / `toshioAnchorId`）を `ResultPhase` 側に戻す必要がある
- 構造図は左から右へ一方向の層状レイアウト（本物の設定 → キャラ・物 → シオリの主張 → としお）。目的語の辺（`object`）は逆向きになるので図には描かない（データには残る）

## 既知の問題・未解決

- **作り話が claims に記録されない（または canon 扱いになる）ことがある**。嘘として保存されず、矛盾チェックにも答え合わせの印にも乗らない。generate の記録漏れで、根本対処は未着手
- 嘘の頻度: directive 導入後の長いセッション（20ターン以上）での頻度は未計測。`strategy` / `regenerated` は db に保存されない（SSE で流すだけ）ので、測るなら `metadata` を残すか `fabricatedFacts.createdAt` で数える
- 構造図でラベルどうしの重なりはまだ起きうる

## 環境メモ

- 既定モデルは `gemini-3.5-flash-lite`（issue #11）。`gemini-3.6-flash` の無料枠は 1日20リクエスト程度。2.x 系は新規ユーザー向けに廃止済み（404）
- 先輩のキーは `.env.local` の `GEMINI_API_KEY_2=` に入れる（空欄の行を用意済み）。本番は `fly secrets set GEMINI_API_KEY_2=...`
- dev サーバーの並行起動: `NEXT_DIST_DIR=.next-3001 npm run dev -- -p 3001`（`next.config.mjs` で distDir を切り替える）。別 distDir で起動すると `tsconfig.json` の include に `.next-XXXX` が自動追加されるので、コミット前に戻すこと
- 実画面の確認は本物の `.data/db.json` を汚さないよう `DATA_DIR` をスクラッチに向けた別サーバーでデモセッションを作って行う（答え合わせすると会話が終わるため）
- ユーザー環境に Herdr の Claude 連携（`~/.claude/hooks/herdr-agent-state.sh`）が入っている。リポジトリの実装とは無関係

## 次にやるとよいこと

- PR #8 のレビュー・`dev` へのマージ → 続けて本ブランチの PR をマージ
- 実 API で directive 方式と答え合わせ（quote の付き方）を通しで確認する
- としおの発言の `FabricatedFact` 化（シオリとの嘘共有）は別 issue

# HANDOFF

## 2026-09-15: claims 抽出の分離 + 嘘のエスカレーション（ブランチ `feat/claims-extractor`）
- 詳細は [docs/handoff-claims-extractor.md](docs/handoff-claims-extractor.md)。generate は返答文だけを書き、主張の三つ組は `lib/server/llm/extract.ts` が別呼び出しで取り出す（grounding はモデルではなくコードが canonFacts との照合で決める）。セッションの進行度で嘘の頻度と密度だけを上げる（閾値は `lib/server/llm/directive.ts` の先頭）。

AIがセッションを開始する際はまずこれを読むこと（AGENTS.md参照）。作業を終えるAIは、次のAIが初見で状況を把握できるようここを更新してから終わること。

コードの構造・設計原則は AGENTS.md が正。ここには「いまどこまで進んでいて、何が決まっていて、何が未解決か」だけを書く。過去セッションの作業ログは残さず、必要なら git log を読む。

## 現在の状態（最終更新: 2026-09-15）

- **作業ブランチ: `feat/reveal-no-explanation`**（worktree `../chat-checking`、`feat/checking_mockup` から分岐。コミット済み・未 push）。答え合わせの結果画面から解説文・根拠・注釈をすべて削った（下記「答え合わせ」節）
- 親ブランチ: **`feat/checking_mockup`**。答え合わせ機能 + としおの実装（`feat/issue-6-toshio` をマージ済み）+ 全体のリファクタ。**PR は `dev` 向き**で、#8（としお）が先にマージされれば差分は答え合わせとリファクタ分だけになる
- 未マージPR: **#8** `feat: 「としお」の割り込み考察を追加`（`feat/issue-6-toshio` → `dev`）。issue #6 / #10 を閉じる
- `../chat`（`feat/issue-6-toshio` の worktree）には未コミットの差分（`globals.css` / `tailwind.config.ts` / `docs/HANDOFF.md` / `scripts/` / `pictures/toshio.png`）が残っている。こちらの worktree には含めていない
- 検証: `npm test` 129件・`tsc`・`eslint`・`next build` 通過。**実 API では未確認**（`gemini-3.6-flash` の日次無料枠が少ないため。動作確認はすべて vitest のモック経由）

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
- 構造図（`components/reveal/RevealGraph.tsx` + `lib/client/graph-layout.ts` + `lib/server/reveal/graph.ts`）は結果画面から外しただけで、コードもテストも API の `graph` フィールドも残してある。いまどの画面からも描画していない（debug 画面も使っていない）。復活させるなら `RevealGraph` を import し、飛び先の `id`（`statementAnchorId` / `toshioAnchorId`）を `ResultPhase` 側に戻す必要がある
- 構造図は左から右へ一方向の層状レイアウト（本物の設定 → キャラ・物 → シオリの主張 → としお）。目的語の辺（`object`）は逆向きになるので図には描かない（データには残る）

## 既知の問題・未解決

- **作り話が claims に記録されない（または canon 扱いになる）ことがある**。嘘として保存されず、矛盾チェックにも答え合わせの印にも乗らない。generate の記録漏れで、根本対処は未着手
- 嘘の頻度: directive 導入後の長いセッション（20ターン以上）での頻度は未計測。`strategy` / `regenerated` は db に保存されない（SSE で流すだけ）ので、測るなら `metadata` を残すか `fabricatedFacts.createdAt` で数える
- 構造図でラベルどうしの重なりはまだ起きうる

## 環境メモ

- `gemini-3.6-flash` の無料枠は 1日20リクエスト程度。使い切ったら `.env.local` に `GEMINI_MODEL=gemini-3.5-flash-lite`（gitignore 対象）。2.x 系は新規ユーザー向けに廃止済み（404）
- dev サーバーの並行起動: `NEXT_DIST_DIR=.next-3001 npm run dev -- -p 3001`（`next.config.mjs` で distDir を切り替える）。別 distDir で起動すると `tsconfig.json` の include に `.next-XXXX` が自動追加されるので、コミット前に戻すこと
- 実画面の確認は本物の `.data/db.json` を汚さないよう `DATA_DIR` をスクラッチに向けた別サーバーでデモセッションを作って行う（答え合わせすると会話が終わるため）
- ユーザー環境に Herdr の Claude 連携（`~/.claude/hooks/herdr-agent-state.sh`）が入っている。リポジトリの実装とは無関係

## 次にやるとよいこと

- PR #8 のレビュー・`dev` へのマージ → 続けて本ブランチの PR をマージ
- 実 API で directive 方式と答え合わせ（quote の付き方）を通しで確認する
- としおの発言の `FabricatedFact` 化（シオリとの嘘共有）は別 issue

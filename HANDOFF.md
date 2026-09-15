# HANDOFF

AIがセッションを開始する際はまずこれを読むこと（AGENTS.md参照）。作業を終えるAIは、次のAIが初見で状況を把握できるようここを更新してから終わること。

コードの構造・設計原則は AGENTS.md が正。ここには「いまどこまで進んでいて、何が決まっていて、何が未解決か」だけを書く。過去セッションの作業ログは残さず、必要なら git log を読む。

## 現在の状態（最終更新: 2026-09-15）

- **作業ブランチ: `feat/session_rag`**（PR **#18** `feat: 話題の切り替わりを判定してRAGを引き直す（issue #14）` → `dev`）。`origin/dev`（#8 としお・#13 答え合わせ + ディレクトリ再編・directive 方式の生成 をマージ済み）を **このブランチにマージしてコンフリクトを解消した**。PR はマージ可能な状態
- マージで決めたこと:
  - 生成は dev の **directive 方式**（`llm/directive.ts` が「今回の指示」を決め、strategy はモデルに出させない）を正とし、その上に issue #14 の「今日の話題」節・`topic`/`pastTopics` の文脈・話題単位の履歴切り出し（`historyForTopic`）を載せた
  - evaluate は dev のとおり **ネタバレ検査なし**（既存の嘘との矛盾・本物の設定の上書きだけ）。PR 側の `allCanonFacts`/`currentEpisode` を evaluate に渡す経路と、それを見ていたテスト1件は削除した
  - 視聴進捗の入力（`progress-resolver` / `resolveProgress` / `ProgressCandidate`）は PR のとおり **廃止**。セットアップ画面は作品選択だけで、話題は最初の発話から決める
  - としおは dev の `premises`（この返答の fabricated claims）方式。PR の `markLies`（【嘘】印）は捨て、`topic` だけ足した
  - ファイルは dev の配置（`components/{chat,setup,reveal,ui,debug}/`、`lib/server/reveal/{build,graph,types}.ts`、`lib/client/format.ts`）。PR が足した `sessionLabel` / `episodeFromLabel` は `lib/client/types.ts` のまま。`ChatInput.test.tsx` は `components/chat/` へ移した
- 検証: `npm test` 226件・`tsc`・`eslint`・`next build` 通過。**実 API では未確認**
- 直前の `feat/checking_mockup`（#13）と `feat/issue-6-toshio`（#8）は dev にマージ済み

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
- としおの発言は `FabricatedFact` 化されておらず、答え合わせでも一文ごとの真偽は出さない（直前のシオリの嘘に「乗った」ことだけ示す）

### 答え合わせ
- 設計は AGENTS.md「答え合わせ」節。結果画面の配置は「概要 → 発言順の答えと根拠 → 真偽をマークした会話 → 折りたたみの構造図」、幅 800px 1カラム
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

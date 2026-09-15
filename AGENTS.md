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
  "sources":    [ { "kind": "mediawiki", "endpoint": "https://ja.wikipedia.org/w/api.php", "page": "記事名", "sections": ["連作エピソード", "登場キャラクター", ...] } ],
  "arcs":       [ { "id": "arc-pajama", "title": "パジャマパーティーズ編", "episodeFrom": 144, "episodeTo": 155, "aliases": ["パジャマパーティーズ", ...] } ],
  "episodes":   [ { "id": "ep-001", "episodeNumber": 1, "title": "出発", "summary": "..." } ],
  "canonFacts": [ { "id": "...", "episodeFrom": 7, "subject": "...", "relation": "...", "object": "...", "description": "..." } ]
}
```

- `canonFacts` が「本物の設定」。`subject / relation / object` の三つ組 + 一文の説明
- `episodeFrom` がネタバレ境界。ユーザーの視聴話数以下のものしかモデルに渡さない
- `sources` は会話の話題を調べにいく外部の知識源（下の「話題の場面」）。`sections` を書くとその章（と記事冒頭の導入）だけを使う。コラボ・グッズ・スタッフ一覧のような物語と関係ない章は外しておく
- `arcs.aliases` は、話題の場面（外部資料の「『〇〇』編」などの見出し）を arc に対応づけて視聴済み話数を決めるのと、発話解析で arc の言及を拾うのに使う
- `creators` は作り手（`{ "role": "原作", "name": "...", "source": { mediawiki の記事 }, "style"?: [...] }`）。としおが「この作者はこういう描き方をする人だから、あの細部は意図的で本当は〜」と作風を土台に考察を組むための材料。データ側に要るのは役割・名前・本人の記事名だけで、作風の要点は `lib/server/creator.ts` が記事から資料係（`llm/creator.ts`）に1回だけ抜かせて `DATA_DIR/creators/<workId>.json` に残す。`style` を手で書けば記事は読まない。実在の人物なので、抜くのは作品内の描き方の癖だけ（私生活・発言・経歴は入れない）。無ければとしおは作風なしで語る
- `entities` はキャラ・場所・物の正式名と別名。発話解析（`llm/analyze.ts`）、外部資料の検索（別名で書かれても正式名で探す）と、嘘を保存する前の表記ゆれ吸収（`lib/server/claims.ts`）に使う。別名が足りないと同じキャラの嘘が別物扱いになり矛盾検出が抜けるので、作品を足すときは主要キャラ分を必ず書く

同じディレクトリに `cards.jsonl`（命題カード）も置いてあるが、これは `docs/specs/spec.md` の構想用で**現状コードは読んでいない**。

### 話題の場面（セッションごとの RAG、issue #14）

話数は聞かない。セッションはシオリの定型「……今日は何について話したい?」から始まり、ユーザーの答えから話題の場面を外部の知識源で調べる（以前のシーン検索 = 自由記述→話数の `progress-resolver` は廃止）。

- `lib/server/sources.ts` — `sources` の MediaWiki 記事を TextExtracts で取り、段落に区切る（プロセス内キャッシュ）。発話との**文字 bigram の IDF 重み付き重なり**で段落を順位付けする（下のベクトル検索と併用）
- `lib/server/topic.ts` の `lookupSessionTopic` — 上位の段落を資料係（`llm/topic.ts`、Gemini 1回・構造化出力）に渡し、場面の名前・要約・事実（`relation` は claims と同じ閉じた語彙）を**資料に書かれたことだけから**抜かせる。場面が `arcs` に対応すればその arc の最後の話を視聴済み話数にする
- 結果は `ChatSession.topic` に保存し、事実は `topic-<何番目の話題>-<連番>` の id の canonFact として以後の retrieve / generate / evaluate / としお / 答え合わせに流れる（`retrieval.getVisibleCanonFacts`）。**話題が決まるまでは発話のたびに調べ、決まった後は下の「話題の切り替わり」を判定したときだけ引き直す**。挨拶のように文字でも意味でも資料と重ならない発話では資料係を呼ばない。失敗しても話題なしのままシオリは返事をする
- 段落の検索は bigram とベクトルの2本立て（`topic.selectCandidates`）。ベクトルは言い換え（「大きい敵を倒しにいく話」→『おっきい討伐』編）や固有名詞の無い曖昧な言い方（「牢屋のとこ」→『プリズン』編）に強く、bigram は固有名詞に強い
  - 文字で十分に重なる（bigram の最高点が3以上）なら、両方の順位を Reciprocal Rank Fusion で混ぜて上位8段落
  - 文字でほとんど重ならなければ、コサイン類似度 0.66 以上の段落だけ（bigram の偶然の重なりは混ぜない）。挨拶・相づち15種の最も近い段落は 0.60〜0.65、文字では重ならない場面の言い換えは 0.66〜0.68 で、差は小さい（gemini-embedding-001・768次元で測った値。モデルを変えたら測り直すこと）。この経路で資料係に渡るのは1〜3段落程度で、文脈はむしろ小さい
- **ベクトルDB（issue #22）**: `lib/server/vector-db.ts`。SQLite に sqlite-vec の拡張を読み込んだ組み込み型で、`DATA_DIR/vectors/<埋め込みモデル>-<次元>.sqlite` のファイル1本に段落の埋め込み（作品ごとの区画）を持ち、近傍の探索も DB の中でする。別のサーバーは立てない。`lib/server/embeddings.ts` が Gemini の埋め込み（`gemini-embedding-001`）と DB への出し入れを受け持つ
  - 埋め込みの無料枠は「1分100件（まとめて送っても1件ずつ数える）」なので、段落は裏で80件ずつ1分おきに埋め込む（段落168件で約2分）。埋め込み済みの段落が1件でもあればその中で探し、1件も無ければ bigram だけで検索する（会話は待たせない）。記事が書き換わってもう無い段落は、次に埋め込むときに DB から消す
  - セッションを作った時点（ユーザーが最初の答えを打つ前）に `topic.prepareTopicSearch` が資料の取得と段落の埋め込みを始める
  - sqlite-vec の Linux 版の拡張は glibc 向けなので、Docker のベースは alpine ではなく Debian（`node:22-bookworm-slim`）。`next.config.mjs` で `sqlite-vec` をバンドルから外し、プラットフォーム別の拡張ファイルを standalone の出力に含めている

#### 話題の切り替わり（`lib/server/topic-shift.ts`）

発話ごとに2段で判定し、切り替わったときだけ RAG を引き直す。

1. **ゲート**（API を呼ばない）: 切り替えの言い回し（「そういえば」「〜の話ってあったよね」など）、いまと別の arc の名前、いまの話題の外の段落への強い重なり、のどれか。続きの発話はここで落ちる（実会話で同じ話題の発話の約2割が通る。本当の切り替えは6/6通った）
2. **判定役**（`llm/router.ts`、`GEMINI_ROUTER_MODEL`）: いまの話題名・直前のシオリの返答（200字まで）・発話・近い段落の見出しだけ（約440トークン）で、切り替えか、切り替えならどんな検索語で引き直すか（指示語を解いた**検索クエリの再構築**）を返す

切り替わったら、組み直した検索語で `lookupSessionTopic` を引き直し（同じ場面なら切り替えとみなさない）、前の話題は `ChatSession.pastTopics` に移す。**会話履歴のクレンジング**: 新しい話題には `since`（きっかけの発話の時刻）を持たせ、`pipeline.historyForTopic` がそれより前の履歴をシオリに渡さない。代わりに前の話題は名前だけプロンプトに入れる。前の話題でついた嘘は `FabricatedFact` として別に渡るので、履歴を落としても矛盾検査は効く。前の話題の事実はシオリには渡さず、evaluate と答え合わせでは引ける

- **Tool Calling（シオリの generate に調べさせる）を採らなかった理由**: ツールを呼ぶ回はシオリの全文脈（約2Kトークン）を2往復送り直し、検索結果の生の段落（上位8件で約1.4Kトークン）がシオリの文脈に積まれる。判定役は別モデル・小さな文脈で、シオリの文脈に入るのは要約した事実（1話題あたり60トークン程度）と話題名だけ
- 判定役を `GEMINI_MODEL` と同じモデルにしないこと。無料枠はモデルごとに1分15回（flash-lite）で、同じにすると切り替えの判定がシオリの枠を削る（実際に 429 になった）
- `ChatSession.currentEpisode` は「話題にした場面から分かる、少なくともここまでは見ている話数」。話題が決まるまで・arc に対応しない話題（人物など）では 0 のままで、work.json の canonFacts は話数では出さない
- Gemini の Google 検索グラウンディングは無料枠のキーでは 429 になるため使っていない
- 資料係が場面より後の展開を事実に混ぜないかはプロンプト頼み（決定的な検査は無い）。人物の段落には後の話が多く書かれているので、ネタバレの経路として意識しておくこと

### 会話パイプライン

`lib/server/llm/pipeline.ts`。1発話ごとに以下を回す。

0. **topic** — セッションに話題の場面がまだ無ければ上の `lookupSessionTopic` で調べ、あれば話題の切り替わりを判定する（切り替わったら引き直し、履歴をクレンジングする）
1. **analyze** — 発話から言及キャラ・出来事・質問種別を抽出。**LLM は使わない**。`entities` / `arcs` の別名との文字列一致と正規表現で済ませる（1発話あたりの API 呼び出しを generate の1回に抑えるため）
2. **retrieve** — 視聴済み範囲の canonFacts をキーワード一致で上位N件 + セッション内の**既存の嘘を全件**（言及キャラに関係するものを先頭に）
3. **generate** — ペルソナ + 材料を渡し、返答文と `strategy` と、返答文が述べた設定上の主張 `claims` を構造化出力で得る。各 claim は `subject / relation(閉じた語彙) / object / negated / grounding(canon|fabricated)` と、返答文の中でその主張を述べた部分の抜き出し `quote`
4. **evaluate** — 決定的検査（`lib/server/llm/evaluate.ts` + `lib/server/claims.ts`）。既存の嘘との矛盾と、本物の設定の直接上書きを検出（ネタバレの検査はしない）
5. flagged なら矛盾の具体的な内容を差し戻し理由に付けて**1回だけ再生成**。それでもダメなら定型の濁し返答に差し替える
6. **としお割り込み**（`pipeline.ts` の `runToshioInterjection` → `llm/toshio.ts`、issue #6）— Route Handler がシオリの返答を流し切って保存した後に呼ぶ（シオリのパイプラインには含めない。としお分の Gemini 待ちでシオリの表示を遅らせないため）。材料（新しい claim か `theory`/`doubt`/`fact_question` 系の質問）があり、直近2ターン以内に割り込んでおらず、シオリが `avoid_spoiler` / `admit_uncertainty` で主張を避けていない場合だけ、2人目のキャラ「としお」に割り込みを検討させる。プロンプト内の `shouldComment` で本人に判断させる単純実装で、シオリのような evaluate → 差し戻しループは持たない（だからシオリが逸らした話題には乗せない）。シオリが語った本物の設定・嘘（この発話でついた嘘も含む）を前提に、それを否定せず「深い考察」を重ねる。失敗しても単に今回は割り込まなかったことにする
   - としおの考察は、コードがランダムに選んだ「切り口」（`toshio.ts` の `THEORY_ANGLES`。反転・隠れた因果・伏線・第三者・都市伝説など、作品を知らない一般的な角度）と、`creators` から用意した作風を土台に組む。頻度は `worthAskingToshio` が決める（ユーザーが考察・理由を求めた／疑った回は2ターン、シオリが嘘をついただけの回は5ターン空ける）
   - としおには、シオリの返答文のうち `grounding=fabricated` の claim の `quote` に当たる部分を `【嘘】〜【/嘘】` で囲んだものを渡す（`toshio.ts` の `markLies`）。としおはどこが嘘かを知ったうえで、嘘を明かさずに乗る。印はバックエンド内だけのもので、SSE にも保存にも載せない。としおが印を出力に写しても `stripLieMarks` で取り除いてから返す

`grounding=fabricated` の claim は正規化（別名→正式名）した上で `FabricatedFact` として `.data/db.json` に保存し、次の発話から材料に含める。これが「矛盾しない嘘」の実体。としおの発言は主張として記録しない（記録するキャラはシオリ1人）。代わりに **ユーザーがとしおの考察について聞いたら、シオリがそれを支える細部（嘘）を足して整合させる**: `directive.ts` の `theoryInQuestion` が「としおの直後の発話（感想だけは除く）」か「としおの文の引用（bigram の重なり）」を拾い、`support_theory` の指示（否定も肯定もせず、成り立つように見える場面の細部を1つ足す）にする。履歴上のとしおの発言は直近1件だけ `generate.ts` が `【としお】` の印を付け 300 字に切ってシオリに渡す（それより古いものは落とす）。

**設計上の原則: 発想は縛らず、整合だけ縛る。** generate に候補選別やスコアリングを噛ませない。LLM が突飛なことを言うのが面白さの源で、構造化はあくまで事後の整合性チェックに限る。矛盾以外の理由で嘘を棄却しないこと。

矛盾判定のルールは `lib/server/claims.ts` にある。`identity / origin / lives_in / first_appeared` は1主語につき1値、`likes/dislikes` と `can/cannot` は対、同じ三つ組の肯定と否定は矛盾。それ以外は共存を許す。本物の設定との照合にも同じルールを使う（`contradictionReason`）。「モモンガ did A」という本物の設定の横に「モモンガ did B」という嘘を足すのは上書きではない（issue #26。以前は主語と関係が同じだけで弾いていて、人物の話題で嘘が毎回差し戻されていた）。関係が自由記述の work.json の canonFacts とは照合しない。テストは `npm test`（vitest。テストは対象の隣に `*.test.ts` として置く）。

### 答え合わせ（会話の終わりに真偽を明かす）

`/reveal/[sessionId]`（`components/reveal/`）+ `app/api/sessions/[sessionId]/reveal`。キャラの口からではなく、アプリの外側から種明かしする（キャラが嘘を認めない原則とは両立する）。

- 真偽の出どころは generate の `claims`。Route Handler がシオリの発話ごとに `saveMessageClaims` で `grounding` と `quote` ごと保存し、`lib/server/reveal/build.ts` が quote の位置で本文を区切って「本当 / 嘘 / 印なし（会話）」に塗り分ける。根拠の canonFact は `getVisibleCanonFacts`（話題の場面の事実 + 視聴済み範囲）だけ出す
- 流れは「予想（本当/嘘を選ぶ）→ 答えを見る → 真偽つきの会話」。答え合わせ前の GET は問題文だけで真偽を返さない
- 答え合わせは1回きり（`ChatSession.reveal`）。済んだセッションにはメッセージを送れない（409）
- としおは主張を記録していないので、直前のシオリの返答の嘘を「知ったうえで乗った」ことだけを示す
- 記録を始める前の旧データは、`FabricatedFact` の嘘だけを本文の位置なしで出す

### 永続化

`lib/server/store.ts`。JSONファイル1本（`.data/db.json`、gitignore済み）にセッション・メッセージ・嘘を全部持つ。単一プロセス・単一ユーザー前提。セッション・嘘のために DB を入れる要件は今のところない。外部資料の段落の埋め込みだけは、ベクトルDB（`lib/server/vector-db.ts`、`.data/vectors/*.sqlite`）に持つ（上の「話題の場面」）。

置き場所は `DATA_DIR` 環境変数で差し替えられる（未設定なら `process.cwd()/.data`）。本番は Fly.io の永続ボリュームを `/app/.data` にマウントし、再起動・再デプロイをまたいで `db.json` とベクトルDBを残す（`fly.toml` の `[mounts]`）。

---

## 技術スタック

| 層 | 選定 |
|---|---|
| フロント | Next.js (App Router) + TypeScript + Tailwind |
| チャットUI | 自前。`POST /api/sessions/[id]/messages` の SSE を `lib/client/sse.ts` で読む |
| バックエンド | Next.js Route Handlers（別サーバーを立てない） |
| LLM | Google Gen AI SDK（`@google/genai`）+ zod 構造化出力 |
| 永続化 | JSONファイル（`.data/db.json`） |
| ベクトルDB | sqlite-vec（`node:sqlite` に読み込む組み込み型。`.data/vectors/`）。外部資料の段落の検索だけに使う |
| デプロイ | Fly.io（Docker コンテナ 1 台 + 永続ボリューム）。`Dockerfile` はホスト非依存で Railway / Render でも動く |

### LLM 呼び出しの ON/OFF は API キーの有無で決まる

`lib/server/llm/client.ts` は `process.env.GEMINI_API_KEY`（と2本目の `GEMINI_API_KEY_2`）だけを SDK（`@google/genai`）に渡す。キーが無ければリクエストが認証エラーになり、パイプラインは catch して定型文にフォールバックする。**`.env.local` にキーを置かない限り API は使われない**。

**キーの切り替え（issue #11）**: `GEMINI_API_KEY_2`（先輩のキー）もあれば、無料枠の上限（429）に達したキーからもう1本に切り替え、同じリクエストをすぐ送り直す。以後はそちらを使い続け、そちらも尽きたら元のキーに戻る（`lib/server/llm/key-pool.ts`）。休ませるのは (キー, モデル) の組で、1日の上限なら太平洋時間の0時まで、1分の上限ならエラーに書かれた待ち時間だけ。両方休み中なら送らずに投げ、今の fallback に任せる。混雑（503）では切り替えない。無効なキーはプロセスの間ずっと外す。`client.ts` の `ai` がこれを包んでいるので、呼び出し側は SDK と同じ `ai.models.generateContent` / `embedContent` のまま使う（`ai` に他のメソッドを足すときは包みにも足すこと）。SDK の `retryOptions` は付けない（429 を待ってから投げるので切り替えが遅れる）。無料枠はプロジェクトごとなので、2本のキーは別アカウントで作ったものでないと意味がない。ログにはキーの文字列ではなく環境変数名を出す

モデルは `GEMINI_MODEL` で差し替え可能。既定は `gemini-3.5-flash-lite`（Google AI Studio の無料枠で使える。`gemini-3.6-flash` は無料枠が1日20リクエストほどで尽きる。`gemini-2.5-flash` は新規ユーザー向けに廃止済み）。API 呼び出しは1発話あたり generate の1回（差し戻し時は2回）、としおが割り込むときに+1回、話題の場面が決まるまでの発話と話題が切り替わった発話で資料係の+1回、切り替わりのゲートを通った発話で判定役の+1回（別モデル）、話題を調べる発話（話題が決まるまでは挨拶も含む）で検索語の埋め込み+1件（別モデル）、作品の段落を初めて埋め込むときに段落の件数分（裏で1分80件ずつ）。

### 意図的に選んでいない技術

提案しないこと。理由があって外している。

- **Python バックエンドの分離** — 3日で結合を2回やる余裕がない
- **Supabase / Postgres / サーバーを立てるベクトルDB（Chroma・Qdrant・pgvector など）** — 単一ユーザー・設定数十件・書き込みほぼ無しの要件に対して過剰で、コンテナ1台の構成も崩れる。canonFacts・嘘の retrieval はキーワード一致で足りている。ベクトルDBは外部資料の段落の検索（話題の特定）にだけ、組み込み型の sqlite-vec を使う（issue #22）。セッション・嘘の永続化を SQLite に移す要件は今のところない
- **LangChain 等のフレームワーク** — 処理が単純で、抽象層のデバッグコストの方が高い
- **LoRA / ローカルLLM** — 口調はプロンプトのみで維持する方針。崩れることが確認できるまで入れない。勝手に学習パイプラインを組み始めないこと

---

## ディレクトリ

```
app/
  page.tsx                          作品選択（SetupScreen。スタート画面は作り直し予定）
  chat/[sessionId]/page.tsx         チャット画面
  debug/[sessionId]/page.tsx        管理画面。本物の設定と生成された嘘を並べて見る
  reveal/[sessionId]/page.tsx       答え合わせ画面（ユーザー向け）。予想 → 真偽つきの会話
  api/
    works/                          作品一覧・詳細
    sessions/                       セッション作成・取得
    sessions/[sessionId]/messages/  チャット本体（SSE）。パイプラインはここから呼ぶ
    sessions/[sessionId]/{canon-facts,fabricated-facts,fabricated-graph}/  debug 画面用
    sessions/[sessionId]/reveal/    答え合わせ（GET: 問題 or 結果 / POST: 予想を送って答え合わせ済みにする）
components/
  chat/                             チャット画面（ChatApp / Sidebar / ChatInput ほか）
  reveal/                           答え合わせ画面（RevealView → GuessPhase / ResultPhase / RevealGraph、verdict.ts は表示ルール）
  setup/SetupScreen.tsx             作品選択 + 視聴進捗入力
  debug/DebugView.tsx               管理画面
  ui/                               画面をまたいで使うもの（Mascot, icons）
lib/
  server/
    works.ts                        data/ の読み込み
    store.ts                        .data/db.json の読み書き
    retrieval.ts                    canonFacts / 既存の嘘の取り出し
    sources.ts                      外部の知識源（MediaWiki）の取得・段落分け・検索（bigram・順位の融合）
    embeddings.ts                   外部資料の段落のベクトル検索（Gemini の埋め込み・裏での埋め込み作成）
    vector-db.ts                    ベクトルDB（sqlite-vec。DATA_DIR/vectors/ の SQLite ファイル）
    topic.ts                        話題の場面の特定（セッションごとの RAG）
    topic-shift.ts                  話題の切り替わりの判定（ゲート → 判定役）
    rate-limit.ts
    sse.ts                          Route Handler が text/event-stream を書くための口
    types.ts                        データモデル（答え合わせ専用の型は reveal/types.ts）
    llm/                            router（切り替わりの判定役）/ topic（資料係）→ analyze → directive → generate → evaluate → pipeline（+ toshio: としおの割り込み）
    reveal/                         答え合わせ。build.ts が発話を本当/嘘の部分に区切り、graph.ts が嘘の構造図を組む
  client/                           fetch ラッパー（api.ts）・SSE パーサ・表示用型・時刻整形（format.ts）・構造図のレイアウト
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
- **未視聴範囲を漏らす経路を作らない**。`getAllCanonFacts` は debug 画面と evaluate（ネタバレ検出）専用。生成に渡すのは `getCanonFactsUpTo` の結果と、話題の場面について外部資料で確かめた事実だけ

### work.json を書くとき

- 既存作品のセリフ・地の文をそのまま写さない。事実を自分の言葉で1文にまとめる
- 1 canonFact 1主張。`subject / relation / object` に分解できない事実は入れない
- `episodeFrom` は「その事実が初めて明かされる話数」。迷ったら大きい方に倒す（ネタバレ側に安全）

### 環境変数

```
GEMINI_API_KEY=          # .env.example をコピーして .env.local に
GEMINI_API_KEY_2=        # 省略可。2本目（先輩）のキー。上限に達したら1本目と切り替える
GEMINI_MODEL=            # 省略可。既定 gemini-3.5-flash-lite
GEMINI_ROUTER_MODEL=     # 省略可。話題の切り替わりの判定役。既定 gemini-3.1-flash-lite
GEMINI_EMBEDDING_MODEL=  # 省略可。外部資料のベクトル検索。既定 gemini-embedding-001
DATA_DIR=                # 省略可。db.json とベクトルDB（vectors/）の置き場所。本番はボリュームのマウント先（/app/.data）
```

本番の API キーは `fly secrets set GEMINI_API_KEY=... GEMINI_API_KEY_2=...` で登録する（`.env.local` はイメージに含まれない）。`DATA_DIR` は `fly.toml` の `[env]` で設定済み。

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

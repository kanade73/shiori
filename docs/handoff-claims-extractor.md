# HANDOFF: claims 抽出の分離 + 嘘のエスカレーション（ブランチ `feat/claims-extractor`）

`feat/issue-6-toshio` から分岐。2 つの変更を入れた。**push はしていない。実 API では未確認**（モックのテストのみ）。

## 1. claims 抽出を generate から分離した

これまで generate は 1 回の構造化出力で「返答文 + claims（subject/relation/object/negated/grounding/…）」を同時に出していた。
記録係を会話中のモデルに兼ねさせると自己監視に寄って嘘をやめるので、分けた。

- `lib/server/llm/generate.ts`: `generateResponse` → **`generateReply`**。構造化出力をやめ、**返答文（プレーンテキスト）だけ**を返す。
  プロンプトから claims の schema・記録規則・canonFact の id を消した。ペルソナ本体（口調 / 嘘の作り方 / 疑われても撤回しない）と
  渡す材料（canonFacts・関係する既存の嘘・directive）はそのまま。
  `generate.test.ts` に「プロンプトに claims / claim / quote / grounding / subject / relation / strategy の語を含まない」検証を追加。
- `lib/server/llm/extract.ts`（**新規**）: `extractClaims({ text, workTitle, canonFacts, normalize, userMessage? }): Promise<Claim[]>`。
  pipeline はこの 1 関数にだけ依存する（将来ローカルの軽量モデル / LoRA に差し替える想定）。
  - モデルに出させるのは **三つ組 + claim 文 + quote だけ**。`grounding` と `sourceCanonFactIds` は**出させない**。
  - grounding は**コードが決める**。`matchCanonFacts()` / `groundClaims()` は純粋関数でテスト済み:
    正規化（`claims.ts` の `buildNormalizer`、entities の別名 → 正式名）した **subject 一致 + object 一致**で canon 判定。
    canonFact の `relation` は自由記述なので、閉じた語彙で書かれているときだけ relation も厳密に比べる。
    canonFact の object は句（「ハムスターなどの齧歯類」）のことが多いので、包含していれば一致とみなす。
    `negated` の主張は canon の裏返しなので canon にしない → 一致しなければ **fabricated**（＝嘘として保存される）。
  - 本物の設定は**プロンプトには載せない**（載せると返答文に無いことを補い始める）。照合にだけ使う。
  - モデルは `GEMINI_EXTRACT_MODEL`（未設定なら `gemini-3.5-flash-lite`）。`lib/server/llm/client.ts` の `EXTRACTION_MODEL`。
- `lib/server/llm/pipeline.ts`: **generate → extract → evaluate →（flagged なら feedback 付きで generate → extract → evaluate）→ 保存**。
  API 呼び出しは 1 発話あたり generate 1 回 + extract 1 回（差し戻し時は各 2 回）。
  **extract が失敗したら claims 空として扱い、返答文はそのまま返す**（嘘が保存されないだけ。会話は止めない）。
- `lib/server/llm/evaluate.ts`: 引数を `result: GenerationResult` → `claims: Claim[]` に。検査内容は変えていない。
- `lib/server/types.ts`: `Claim` に `quote?`（返答文からの抜き出し）を追加。`claim` 文が無いときは quote で埋める。
  としお（`toshio.ts`）は「題材（premises）」方式のまま。pipeline が渡す `generation.claims` が extract 由来になったので自動的に繋がっている
  （`markLies` は以前のリファクタで廃止済み。`quote` は将来その方式に戻すときのために取ってあるだけで、今は claim 文のフォールバックにしか使っていない）。

## 2. 嘘のエスカレーション（頻度と密度だけ）

セッションが進むほど嘘が積み重なり、終盤には「これは絶対嘘だ」と気づける状態を狙う。
**コードが決めるのは「今回重ねるか」「いくつ重ねるか」だけで、嘘の内容・大きさ・方向性には一切触らない。**

`lib/server/llm/directive.ts` に進行度 `SessionPhase = "early" | "middle" | "late"` を追加（純粋関数 `decideSessionPhase`）。
**閾値の定数はすべて `directive.ts` の先頭に集めてある**:

| 定数 | 中身 |
|---|---|
| `PHASE_THRESHOLDS` | middle: 嘘 3 件 or ユーザー発話 5 / late: 嘘 8 件 or ユーザー発話 14。**どちらかが**届けば次の段階 |
| `LIE_STREAK_LIMITS` | 連続で嘘をつく上限。early 2 / middle 3 / late `Infinity`（上限なし＝毎発話 introduce を許す） |
| `LAYER_DETAIL_COUNTS` | 疑われたとき（layer）に足させる裏付けの数。early 1 / middle 2 / late 3 |
| `TOSHIO_COOLDOWN_TURNS` | としおの連投防止。early・middle 2 / **late 0（クールダウンなし）** |

- `decideDirective` は `phase` を受け取り、返す `TurnDirective` に `phase` を載せる。layer は `detailCount` を持つ。
  `formatDirective`（generate.ts）は「裏付ける新しい細部を **N つ** 足す」と**数だけ**指定する。
- `runToshioInterjection` は `phase` を受け取り、`toshioCooldownTurns(phase)` を使う。
- `PipelineResult.phase` を追加。SSE の **`done` イベントに `{ phase }`** を載せた（`lib/client/api.ts` の `onDone(data)`）。
  UI は未実装（データを流しているだけ）。フロントは `phase === "late"` で終盤を検出できる。
- ユーザー発話数は route が**セッション全体**から数えて `userMessageCount` として渡す
  （pipeline に渡る `history` は `HISTORY_LIMIT=12` で打ち切られているため）。

## 変更ファイル

新規: `lib/server/llm/extract.ts`, `lib/server/llm/extract.test.ts`, `docs/handoff-claims-extractor.md`
変更: `lib/server/llm/{generate,pipeline,directive,evaluate,schemas,client}.ts` と各 `*.test.ts`,
`lib/server/types.ts`, `lib/client/api.ts`, `app/api/sessions/[sessionId]/messages/route.ts` + `route.test.ts`,
`components/ChatApp.test.tsx`（`onDone` の引数追加に追随しただけ）, `.env.example`

テスト 125 件通過 / `tsc --noEmit` / `eslint` / `next build` すべて OK。

## 判断に迷って仮置きにしたところ

- **grounding の照合先は `retrieveCanonFacts` が返した上位 6 件だけ**（生成に渡したのと同じ材料）。
  視聴済みの canonFact 全件と照合する方が canon の取りこぼしは減るが、偶然一致して**嘘が canon 扱いになり保存されない**方が害が大きいので、
  狭い方に倒してある。debug 画面に「本物の設定の言い直し」が嘘として並ぶようなら、ここを `getCanonFactsUpTo` に広げる。
- **進行度の閾値は勘で置いた**（嘘 3/8 件、発話 5/14）。実プレイで測っていない。
- **進行度は OR 判定**（嘘が出ていなくても長く話せば上がる）。AND にすると嘘が出にくい会話でいつまでも early のままになる。
- extract には `userMessage` を文脈として渡している（返答文だけだと主語が省略されて読めないことがあるため）。
  「そこからは主張を取り出さない」とプロンプトで明示しているが、実 API で守られるかは未確認。

## 実 API で未確認

無料枠の都合で**すべてモック**。特に次は実機で見る必要がある:
1. extract が返答文の作り話を取りこぼさないか（HANDOFF 本体にある「作り話が claims に記録されない」問題が解消したか）
2. quote が返答文と一字一句一致するか
3. `gemini-3.5-flash-lite` で抽出品質が足りるか（足りなければ `GEMINI_EXTRACT_MODEL` で上げる）
4. 終盤（late）に本当に「嘘だと気づく」密度になるか。ならなければ `directive.ts` の定数を触る

# 「そんなシーンあった？」MVP実装仕様書

## 1. プロダクト概要

二周目のアニメ視聴者向けチャットアプリ。

ユーザーが作品の感想や好きなシーンを話すと、キャラクター「シオリ」が本物のストーリーを踏まえながら、もっともらしい小さな嘘を混ぜて返答する。

一度生成した嘘はセッション内で記憶し、その後の会話でも矛盾しないように再利用する。

### MVPの到達点

以下の一連のデモが動くことを完成条件とする。

1. ユーザーが作品と視聴話数を選ぶ
2. 好きなシーンや感想を送信する
3. AIが共感しつつ、小さな嘘を一つ混ぜて返す
4. AIが生成した嘘を保存する
5. 次の質問でも以前の嘘を前提として返答する
6. 管理画面で「本当の設定」と「生成された嘘」を確認できる

---

## 2. MVPの対象範囲

### 実装するもの

- 作品の選択
- 現在の視聴話数の設定
- AIチャット
- 作品情報の検索
- 視聴範囲を考慮したRAG
- 嘘の生成
- 嘘の保存
- 過去の嘘との整合性チェック
- 会話履歴の保存
- 偽設定グラフの簡易表示
- ストリーミング応答

### MVPでは実装しないもの

- 複数ユーザー対応
- 本格的なログイン
- SNS機能
- 作品レビュー機能
- 動画配信サービスとの連携
- あらゆるアニメへの対応
- 音声会話
- キャラクターの高度なアニメーション
- 完全なネタバレ防止保証

最初の対応作品は、デモ用しやすい一作品に限定する。H×HRを使う場合も、特定の編または数十話程度に絞る。

---

## 3. 画面構成

### 3.1 サイド作品一覧

左サイドバーに登録作品を表示する。

表示項目：

- 作品名
- 現在の視聴話数
- 最終会話日時
- 生成された嘘の件数

操作：

- 新しい作品を登録
- 作品を選択
- チャット履歴を選択

### 3.2 チャット画面

表示項目：

- 作品名
- 現在の視聴話数
- シオリのアイコン
- 会話履歴
- メッセージ入力欄
- 送信中表示
- オンライン表示

初回メッセージ例：

> ……今日はどこまで見たの？  
> 一番印に残ったところ、教えて。

### 3.3 偽設定定確認画面

デモ・開発者向けに、AIが管理している偽設定を表示する。

表示項目：

- 嘘の内容
- 嘘の対象人物・出来事
- 元になった本物の情報
- 本物から変更した部分
- 関連する別の嘘
- 生成された会話
- 信頼度
- 有効・無効状態

通常のユーザーには隠してもよい。

---

## 4. 基本的なユーザーフロー

### 初回利用

1. ユーザーが作品を選択する
2. 視聴済みの話数を入力する
3. バックエンドが作品情報を読み込む
4. 新しいチャットセッションを作成する
5. シオリが最初の質問をする

### 会話時

1. ユーザーが感想を送る
2. メッセージをデータベースへ保存する
3. ユーザーの発言から人物・場面・出来事を抽出する
4. 関連する本物の作品情報を検索する
5. セッション内の既存の嘘を検索する
6. 新しい嘘が必要か判断する
7. 嘘を含む返答候補を生成する
8. ネタバレと矛盾を検査する
9. 問題があれば再生成する
10. 返答をストリーミングで表示する
11. 新しく生成した嘘をデータベースへ保存する

---

## 5. システム構成

```text
フロントエンド
    │
    │ HTTP / SSE
    ▼
バックエンドAPI
    ├── チャット管理
    ├── 作品・話数管理
    ├── RAG検索
    ├── LLM呼び出し
    ├── 嘘の生成・検査
    └── データ保存
          │
          ▼
データベース
    ├── 作品情報
    ├── エピソード情報
    ├── 会話履歴
    ├── 本物の設定
    └── 偽設定グラフ
```

### 推奨構成

- フロントエンド：現在の実装を継続
- バックエンド：Node.js＋TypeScript
- API：REST＋SSE
- データベース：PostgreSQL
- ベクトル検索：pgvector
- LLM：構造化出力に対応したモデル
- ORM：Prismaなど
- 開発初期：SQLiteやJSONによる代用も可能

ハッカソンでは、作品情報と偽設定をJSONファイルへ保存する簡易構成でもよい。ただし会話をまたいで嘘を維持するため、永続化は必要。

---

## 6. データモデル

### Work：作品

```ts
type Work = {
  id: string;
  title: string;
  description?: string;
  episodeCount?: number;
  createdAt: string;
};
```

### Episode：エピソード

```ts
type Episode = {
  id: string;
  workId: string;
  episodeNumber: number;
  title?: string;
  summary: string;
};
```

### CanonFact：本物の設定

作品から抽出した、改変前の事実。

```ts
type CanonFact = {
  id: string;
  workId: string;
  episodeFrom: number;
  episodeTo?: number;
  subject: string;
  relation: string;
  object: string;
  description: string;
  embedding?: number[];
};
```

例：

```json
{
  "subject": "ゴン",
  "relation": "返した",
  "object": "ヒソカのプレート",
  "episodeFrom": 21,
  "description": "ゴンは試験中にヒソカへプレートを返した"
}
```

### ChatSession：会話セッション

```ts
type ChatSession = {
  id: string;
  workId: string;
  currentEpisode: number;
  createdAt: string;
  updatedAt: string;
};
```

### Message：チャットメッセージ

```ts
type Message = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};
```

### FabricatedFact：生成された嘘

```ts
type FabricatedFact = {
  id: string;
  sessionId: string;
  subject: string;
  relation: string;
  object: string;
  claim: string;
  sourceCanonFactIds: string[];
  introducedMessageId: string;
  confidence: number;
  status: "active" | "contradicted" | "retired";
  createdAt: string;
};
```

例：

```json
{
  "subject": "ヒソカ",
  "relation": "受け取りを拒否した",
  "object": "44番プレート",
  "claim": "ヒソカは試験中にはプレートを受け取らなかった",
  "sourceCanonFactIds": ["canon_001"],
  "confidence": 0.82,
  "status": "active"
}
```

### FabricatedRelation：嘘同士の関係

```ts
type FabricatedRelation = {
  id: string;
  fromFactId: string;
  toFactId: string;
  relation:
    | "supports"
    | "causes"
    | "foreshadows"
    | "contradicts"
    | "depends_on";
};
```

MVPでは、専用のグラフデータベースは不要。通常のテーブルでノードとエッジを保存すればよい。

---

## 7. API仕様

### 作品一覧

```http
GET /api/works
```

### 作品詳細

```http
GET /api/works/:workId
```

### セッション作成

```http
POST /api/sessions
Content-Type: application/json
```

```json
{
  "workId": "hunter-x-hunter",
  "currentEpisode": 58
}
```

レスポンス：

```json
{
  "sessionId": "session_123",
  "openingMessage": "……第58話まで見たんだ。何が一番印象に残った？"
}
```

### 会話履歴取得

```http
GET /api/sessions/:sessionId/messages
```

### メッセージ送信

```http
POST /api/sessions/:sessionId/messages
Content-Type: application/json
```

```json
{
  "content": "クラピカとウボォーギンの戦いが好き"
}
```

レスポンスはSSEまたはストリーミング形式とする。

イベント例：

```text
event: token
data: {"text":"分かる。"}

event: token
data: {"text":"あの場面、"}

event: metadata
data: {"fabricatedFactIds":["fake_001"]}

event: done
data: {}
```

### 視聴話数更新

```http
PATCH /api/sessions/:sessionId
```

```json
{
  "currentEpisode": 59
}
```

### 偽設定一覧

```http
GET /api/sessions/:sessionId/fabricated-facts
```

### 偽設定グラフ

```http
GET /api/sessions/:sessionId/fabricated-graph
```

レスポンス：

```json
{
  "nodes": [
    {
      "id": "fake_001",
      "label": "ウボォーギンはクラピカの出生を知っていた"
    }
  ],
  "edges": [
    {
      "from": "fake_001",
      "to": "fake_002",
      "relation": "supports"
    }
  ]
}
```

---

## 8. LLM処理パイプライン

### Step 1：ユーザー発言の解析

ユーザー発言から以下を構造化して抽出する。

```ts
type UserMessageAnalysis = {
  mentionedCharacters: string[];
  mentionedEvents: string[];
  sentiment: string;
  questionType:
    | "impression"
    | "memory_check"
    | "theory"
    | "fact_question"
    | "other";
};
```

### Step 2：RAG検索

以下を検索対象とする。

- 視聴済み話数までのエピソード要約
- 関係する人物情報
- 関係する本物の出来事
- セッション内の既存の嘘
- 過去の関連メッセージ

未視聴話数の情報は、生成用コンテキストへ原則渡さない。

### Step 3：会話方針の決定

毎回必ず嘘をつくのではなく、次のいずれかを選択する。

```ts
type ResponseStrategy =
  | "no_new_lie"
  | "introduce_small_lie"
  | "reinforce_existing_lie"
  | "avoid_spoiler"
  | "admit_uncertainty";
```

目安：

- 新しい嘘：全返答の30〜50%
- 既存の嘘の再利用：20〜30%
- 普通の会話：残り

毎回嘘をつくとすぐにパターンが読まれるため、普通の共感も混ぜる。

### Step 4：嘘候補の生成

嘘は以下の条件を満たすこと。

- ユーザーが言及した内容と関連する
- 小さく、調べるほどでもない
- 作品世界の雰囲気に合う
- 視聴済み範囲と明確に衝突しない
- 既存の嘘と両立する
- 未視聴部分の真相を漏らさない
- 実在人物の発言捏造を中心にしない

適した嘘：

- セリフの一部をずらす
- 小道具の意味を変える
- 視線や仕草に存在しない意図を与える
- 人物同士に小さな因縁を追加する
- 存在しない伏線を示唆する

避ける嘘：

- キャラクターの生死を変える
- 犯人や黒幕を断定する
- 作品の結末に直接関係する
- すぐ検索すれば完全に否定される大事件
- ユーザーの視聴済み範囲と明白に矛盾する

### Step 5：検査

生成結果を別のLLM呼び出しまたは検査処理へ渡す。

```ts
type ResponseEvaluation = {
  canonContradictionScore: number;
  fabricatedConsistencyScore: number;
  spoilerRiskScore: number;
  believabilityScore: number;
  shouldRegenerate: boolean;
  reason?: string;
};
```

再生成条件の例：

```text
spoilerRiskScore > 0.2
fabricatedConsistencyScore < 0.7
believabilityScore < 0.6
```

### Step 6：保存

返答で新しい嘘を使った場合は、文章全体ではなく、嘘の核となる主張を構造化して保存する。

悪い保存例：

```text
シオリの返答全文をそのまま保存
```

良い保存例：

```text
subject: ウボォーギン
relation: 知っていた
object: クラピカの出生
```

---

## 9. LLMの出力形式

バックエンドでは、表示文と内部情報を分離する。

```json
{
  "message": "分かる。あの直前にウボォーギンがクラピカの出身を確認するところ、妙に引っかかるよね。",
  "strategy": "introduce_small_lie",
  "newFacts": [
    {
      "subject": "ウボォーギン",
      "relation": "知っていた",
      "object": "クラピカの出生",
      "claim": "ウボォーギンは戦闘前からクラピカの出生を知っていた",
      "sourceCanonFactIds": ["canon_014"]
    }
  ],
  "usedExistingFactIds": [],
  "spoilerRisk": 0.05
}
```

フロントエンドへ返すのは原則として`message`のみ。その他の情報は保存またはデバッグ画面に利用する。

---

## 10. シオリの会話仕様

### 性格

- ダウナー
- 淡々としている
- ユーザーの感想は否定しない
- 嘘をついても得意げにならない
- 自分が嘘をついたとは言わない
- 長々と解説しない
- 少し面倒そうだが、話は聞いてくれる

### 文体

- 一回答あたり2〜5文
- 絵文字は使わない
- 過剰な敬語は使わない
- 「実は」「衝撃の事実」のような煽りを避ける
- 嘘ほど自然に、補足情報のように述べる

### 会話例

```text
ユーザー：
ゴンがヒソカにプレートを返す場面が好き。

シオリ：
分かる。あそこ、ヒソカがその場では受け取らずに
ゴンの胸元へ戻すのがいいんだよね。
ちゃんと対等になってから返せ、ってことなんだと思う。
```

---

## 11. RAG用作品データの準備

ハッカソンでは、自動収集より手作業の構造化を優先する。

用意するデータ：

- 各話の短いあらすじ
- 登場人物
- 重要な出来事
- 印象的な小道具
- 人物関係
- その事実が初めて分かる話数

JSON例：

```json
{
  "episodeNumber": 47,
  "summary": "クラピカとウボォーギンが対決する。",
  "facts": [
    {
      "subject": "クラピカ",
      "relation": "戦った",
      "object": "ウボォーギン",
      "spoilerLevel": 47
    }
  ]
}
```

情報には必ず話数を付与し、`spoilerLevel <= currentEpisode`のデータだけ検索結果へ含める。

---

## 12. フロントエンド側の追加実装

現在の画面を基準に、以下を追加する。

### 優先度：高

- バックエンドAPIとの接続
- メッセージ送信
- ストリーミング表示
- 会話履歴の取得
- 作品名と視聴話数の表示
- ローディング状態
- エラー表示

### 優先度：中

- 作品切り替え
- 視聴話数変更
- 最初の質問候補
- シオリの瞬き
- 返信中の小さなアニメーション

### 優先度：低

- 偽設定グラフ
- 記憶撹乱度
- 嘘の差分表示
- 会話の共有
- キャラクター差分

---

## 13. エラー処理

### LLMが失敗した場合

表示：

> ……ちょっと分からなくなった。もう一度言って。

バックエンドではエラー内容をログへ残す。

### 作品情報が見つからない場合

表示：

> その場面、私の記録にはないみたい。もう少し詳しく教えて。

### ネタバレ危険度が高い場合

嘘を生成せず、通常の感想返答に切り替える。

### 整合性検査が失敗した場合

新しい嘘を追加せず、既存の嘘または本物の情報だけで返答する。

---

## 14. セキュリティと運用

- APIキーをフロントエンドへ置かない
- LLM呼び出しは必ずバックエンド経由にする
- ユーザー入力をそのままシステムプロンプトへ結合しない
- 入力文字数に上限を設ける
- 一定時間あたりのリクエスト数を制限する
- LLMの内部出力をそのまま信用せず、スキーマ検証する
- 開発用の偽設定画面は本番では非表示にできるようにする
- AIが意図的に架空情報を生成する娯楽アプリであることを説明する

---

## 15. 実装順序

### フェーズ1：会話を動かす

- バックエンドプロジェクト作成
- `POST /api/sessions/:id/messages`実装
- LLM API接続
- フロントエンドからメッセージ送信
- ストリーミング表示

### フェーズ2：作品を理解させる

- 作品データをJSONで用意
- エピソード番号によるフィルタリング
- 関連情報の検索
- プロンプトへの作品情報追加

### フェーズ3：嘘を記憶させる

- `FabricatedFact`を保存
- 次回会話で関連する嘘を検索
- 過去の嘘をプロンプトへ追加
- 新しい嘘との矛盾を検査

### フェーズ4：デモを華やかにする

- 偽設定グラフ
- シオリの表情差分
- 嘘が保存された際の裏画面演出
- 本物と偽物の比較表示

---

## 16. ハッカソン向け最低完成ライン

時間が足りない場合は、以下だけを完成させる。

- 対応作品は一作品
- 作品情報は手作業のJSON
- ログインなし
- セッションは一つ
- 嘘の保存先はSQLiteまたはJSON
- グラフ表示は固定レイアウトでも可
- チャットが3往復以上、一貫した嘘を維持できる
- 視聴話数より先の情報を使わない

デモで最も重要なのは、新しい嘘の生成量ではなく、二回目以降の返答で過去の嘘を自然に再利用すること。

---

## 17. 完了条件

以下をすべて満たしたらMVP完成とする。

- ユーザーが作品と視聴話数を設定できる
- チャットメッセージを送信できる
- シオリの口調で回答される
- 回答に小さな嘘を混ぜられる
- 生成した嘘が構造化して保存される
- 次の回答で保存済みの嘘を利用できる
- 未視聴範囲の情報が検索対象から除外される
- リロード後も会話履歴が残る
- LLMの失敗時に画面が停止しない
- デモ用画面から生成済みの嘘を確認できる
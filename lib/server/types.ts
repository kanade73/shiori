import type { RevealState } from "./reveal/types";

// Data model per docs/specs/mvp-spec.md section 6.

export type Work = {
  id: string;
  title: string;
  description?: string;
  episodeCount?: number;
  createdAt: string;
};

export type Episode = {
  id: string;
  workId: string;
  episodeNumber: number;
  title?: string;
  summary: string;
};

export type CanonFact = {
  id: string;
  workId: string;
  episodeFrom: number;
  episodeTo?: number;
  subject: string;
  relation: string;
  object: string;
  description: string;
};

/**
 * A named story arc. Used to map the topic scene the user wants to talk about
 * ("草むしり検定のところ") to an internal episode boundary, and by analyze to
 * spot arcs mentioned in a message. `aliases` are the phrases a user (or an
 * external source's heading) might use to refer to this arc.
 */
export type Arc = {
  id: string;
  workId: string;
  title: string;
  episodeFrom: number;
  episodeTo: number;
  aliases: string[];
};

/**
 * 外部の知識源（work.json の sources）の取り出し先。今は MediaWiki の記事だけ。
 * どの記事を引くかはデータで決め、コードは作品を知らない。
 */
/**
 * 作品の作り手（原作者・監督など）。としおが「この作者はこういう描き方をする人だから」と
 * 作風から考察を組むための材料。データ側に必要なのは役割・名前と、作風を読みにいく記事だけ。
 * `style` を書けば記事を読まずにそれを使う。
 */
export type Creator = {
  /** 原作 / 監督 / シリーズ構成 など */
  role: string;
  name: string;
  /** 作風を読みにいく外部資料（本人の記事）。`sections` で章を絞れる */
  source?: WorkSource;
  /** 手で書いた作風の要点。あれば source を読まない */
  style?: string[];
};

/** 作風の要約（記事から1回だけ抜いて DATA_DIR にキャッシュする） */
export type CreatorProfile = {
  role: string;
  name: string;
  /** 作品内の描き方の癖・傾向を1行ずつ */
  style: string[];
  source?: { title: string; url: string };
};

export type WorkSource = {
  kind: "mediawiki";
  /** 例: https://ja.wikipedia.org/w/api.php */
  endpoint: string;
  /** 記事名 */
  page: string;
  /**
   * 使う章（`== 章 ==` の名前）。書けばその章と記事冒頭の導入だけを使う。
   * コラボ・グッズ・スタッフ一覧のような、物語と関係ない章で検索が濁らないようにするため
   */
  sections?: string[];
};

/** 外部の知識源の記事を、検索できる大きさに区切った1片。 */
export type SourceChunk = {
  id: string;
  /** 記事名 */
  sourceTitle: string;
  url: string;
  /** 章の見出し（「連作エピソード」など） */
  heading: string;
  /** 段落の見出しにあたる短い行（「『草むしり検定』編」やキャラ名など）。無ければ空 */
  label: string;
  text: string;
};

/**
 * 会話の最初にユーザーが「話したい」と言った場面。外部の知識源から取り出した資料で
 * シオリが把握したもので、以後の会話ではここに書かれた設定を本物として扱う。
 */
export type SessionTopic = {
  /** 場面の名前（例: 草むしり検定編）。UI の見出しにも使う */
  title: string;
  summary: string;
  /** 場面に対応する work.json の arc。視聴済み話数の目安に使う */
  arcId?: string;
  /** 資料から読み取った、この場面についての本物の設定 */
  facts: CanonFact[];
  sources: { title: string; url: string }[];
  /** 場面の特定に使った外部資料の段落。話題が切り替わったかの判定に使う（旧データには無い） */
  chunkIds?: string[];
  /** 場面の特定に使ったユーザーの発話 */
  query: string;
  /** 途中で話題が切り替わって決まった話題なら、そのきっかけのユーザー発話の時刻。これより前の履歴はシオリに渡さない */
  since?: string;
  resolvedAt: string;
};

export type ChatSession = {
  id: string;
  workId: string;
  /**
   * ネタバレ境界。ユーザーが話題にした場面から分かる「少なくともここまでは見ている」話数で、
   * 話題が決まるまでは 0（本物の設定を話数で出さない）。
   */
  currentEpisode: number;
  /** いまの話題の場面。まだ決まっていなければ無し */
  topic?: SessionTopic;
  /** 話題が切り替わる前の話題（古い順）。その間についた嘘の根拠や答え合わせのために残す */
  pastTopics?: SessionTopic[];
  /** 旧データのみ: シーン検索（廃止）でユーザーが入力した視聴進捗。表示にだけ使う */
  progressDescription?: string;
  /** 答え合わせ済みなら、その時刻とユーザーの予想。答え合わせした会話は続けられない。 */
  reveal?: RevealState;
  createdAt: string;
  updatedAt: string;
};

/**
 * Which bot persona spoke. Only meaningful when role === "assistant";
 * absent (undefined) on older stored messages means "shiori" - it was the
 * only persona before としお (issue #6).
 */
export type Speaker = "shiori" | "toshio";

export type Message = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  speaker?: Speaker;
};

/**
 * A named thing in the work (character, place, item, group). `aliases` are the
 * surface forms a user or the model might use; lies are normalized to `name`
 * before they are stored so that contradiction checks compare like with like.
 */
export type Entity = {
  id: string;
  workId: string;
  name: string;
  aliases: string[];
};

/**
 * Closed vocabulary for the relation of a claim the model makes about the
 * work. Keeping this closed (instead of free text) is what makes the
 * deterministic contradiction check in lib/server/claims.ts possible.
 */
export type ClaimRelation =
  | "is" // 性質・属性（複数あってよい）
  | "identity" // 正体・本名・種族。1つに決まる
  | "origin" // 由来・元ネタ・モチーフ。1つに決まる
  | "lives_in" // 住んでいる場所。1つに決まる
  | "first_appeared" // 初登場の場面・時期。1つに決まる
  | "has" // 所有・所持
  | "likes"
  | "dislikes"
  | "fears"
  | "can"
  | "cannot"
  | "did" // 過去にした行為・起きた出来事
  | "related_to" // 関係性（家族・師弟・因縁など）
  | "secret" // 隠している事実
  | "other";

export type ClaimGrounding = "canon" | "fabricated";

/**
 * One setting-level claim a reply made, as extracted afterwards by
 * lib/server/llm/extract.ts. The model only produces the triple, the sentence
 * and the quote; `grounding` and `sourceCanonFactIds` are decided in code by
 * matching the triple against the canon facts the user can already see.
 */
export type Claim = {
  subject: string;
  relation: ClaimRelation;
  object: string;
  negated: boolean;
  claim: string;
  grounding: ClaimGrounding;
  sourceCanonFactIds: string[];
  /**
   * 返答文（message）の中でこの主張を述べている部分の抜き出し。答え合わせで本文中の
   * 位置を示すのに使う。モデルが省略することがあるので必須にしない。
   */
  quote?: string;
};

/** 発話ごとに保存する claim。答え合わせで「どの主張が本当/嘘だったか」を示すのに使う。 */
export type StoredClaim = Claim & { id: string };

/**
 * どれだけ嘘が積み上がったか。終盤ほど嘘を重ねる「頻度と密度」だけを上げる
 * （嘘の内容・大きさ・方向性には一切触らない）。lib/server/llm/directive.ts。
 */
export type SessionPhase = "early" | "middle" | "late";

/** バックエンドが1ターンごとに決める、シオリへの「今回の指示」。 */
export type TurnDirective =
  | { kind: "introduce"; phase: SessionPhase }
  /** `detailCount` は裏付けにいくつ細部を足させるか。進行度で増える */
  | { kind: "layer"; phase: SessionPhase; doubted: FabricatedFact[]; detailCount: number }
  /** ユーザーがとしおの考察について聞いている。シオリはそれが成り立つように見える細部（嘘）を足して支える */
  | { kind: "support_theory"; phase: SessionPhase; theory: string }
  /** どの場面の話かまだ分からない（話題が決まらず、見た範囲も分からない）。場面を語らず聞き返す（issue #32） */
  | { kind: "ask_scene"; phase: SessionPhase }
  | { kind: "plain"; phase: SessionPhase };

export type FabricatedFactStatus = "active" | "contradicted" | "retired";

export type FabricatedFact = {
  id: string;
  sessionId: string;
  subject: string;
  relation: ClaimRelation;
  object: string;
  negated: boolean;
  claim: string;
  sourceCanonFactIds: string[];
  introducedMessageId: string;
  confidence: number;
  status: FabricatedFactStatus;
  createdAt: string;
};

export type FabricatedRelationType = "supports" | "causes" | "foreshadows" | "contradicts" | "depends_on";

export type FabricatedRelation = {
  id: string;
  fromFactId: string;
  toFactId: string;
  relation: FabricatedRelationType;
};

// --- LLM pipeline types (docs/specs/mvp-docs/specs/mvp-spec.md sections 8-9) ---

export type QuestionType = "impression" | "memory_check" | "theory" | "fact_question" | "doubt" | "other";

export type UserMessageAnalysis = {
  mentionedCharacters: string[];
  mentionedEvents: string[];
  sentiment: string;
  questionType: QuestionType;
};

export type ResponseStrategy =
  | "no_new_lie"
  | "introduce_small_lie"
  | "reinforce_existing_lie"
  | "admit_uncertainty";

/**
 * 返答文と、そこで述べた主張。
 * 返答文は generate（会話だけ）が書き、claims は extract が後から取り出す。
 * strategy はモデルが選ぶものではなく、保存された嘘の有無から事後に決まる
 * （UI のバッジと、としおのゲーティングに使うだけ）。
 */
export type GenerationResult = {
  message: string;
  strategy: ResponseStrategy;
  /** Every setting-level claim in `message`, canon-grounded or not. */
  claims: Claim[];
};

/**
 * としお（issue #6）の割り込み判定つき出力。プロンプト制御のみの単純実装
 * （分類器・シオリとの嘘共有は別issueで扱う）。shouldComment=false のとき
 * message は無視してよい。
 */
export type ToshioCommentary = {
  shouldComment: boolean;
  message: string;
};

export type ResponseEvaluation = {
  canonContradictionScore: number;
  fabricatedConsistencyScore: number;
  believabilityScore: number;
  shouldRegenerate: boolean;
  reason?: string;
  /** Human-readable description of each detected problem, fed back to the model on regeneration. */
  details: string[];
};

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
 * A named story arc, used to resolve a free-text viewing-progress
 * description ("幻影旅団編を全部見た") to an internal episode boundary.
 * `aliases` are the phrases a user might type to refer to this arc.
 */
export type Arc = {
  id: string;
  workId: string;
  title: string;
  episodeFrom: number;
  episodeTo: number;
  aliases: string[];
};

export type ChatSession = {
  id: string;
  workId: string;
  currentEpisode: number;
  /** The free-text description the user gave at setup, e.g. "幻影旅団編を全部見た". Shown in the UI in place of a raw episode number when present. */
  progressDescription?: string;
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

/** One setting-level claim the assistant made in a reply, as extracted by the model. */
export type Claim = {
  subject: string;
  relation: ClaimRelation;
  object: string;
  negated: boolean;
  claim: string;
  grounding: ClaimGrounding;
  sourceCanonFactIds: string[];
};

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
  | "avoid_spoiler"
  | "admit_uncertainty";

export type GenerationResult = {
  message: string;
  strategy: ResponseStrategy;
  /** Every setting-level claim in `message`, canon-grounded or not. */
  claims: Claim[];
  usedExistingFactIds: string[];
  spoilerRisk: number;
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
  spoilerRiskScore: number;
  believabilityScore: number;
  shouldRegenerate: boolean;
  reason?: string;
  /** Human-readable description of each detected problem, fed back to the model on regeneration. */
  details: string[];
};

// --- Viewing-progress resolution ---

export type ProgressMatchKind = "scene" | "arc" | "episode";

export type ProgressCandidate = {
  episodeNumber: number;
  label: string;
  matchedVia: ProgressMatchKind;
  score: number;
};

export type ProgressResolution = {
  candidates: ProgressCandidate[];
  bestGuess: ProgressCandidate | null;
};

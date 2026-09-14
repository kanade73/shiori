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

export type Message = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type FabricatedFactStatus = "active" | "contradicted" | "retired";

export type FabricatedFact = {
  id: string;
  sessionId: string;
  subject: string;
  relation: string;
  object: string;
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

export type QuestionType = "impression" | "memory_check" | "theory" | "fact_question" | "other";

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

export type NewFactDraft = {
  subject: string;
  relation: string;
  object: string;
  claim: string;
  sourceCanonFactIds: string[];
};

export type GenerationResult = {
  message: string;
  strategy: ResponseStrategy;
  newFacts: NewFactDraft[];
  usedExistingFactIds: string[];
  spoilerRisk: number;
};

export type ResponseEvaluation = {
  canonContradictionScore: number;
  fabricatedConsistencyScore: number;
  spoilerRiskScore: number;
  believabilityScore: number;
  shouldRegenerate: boolean;
  reason?: string;
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

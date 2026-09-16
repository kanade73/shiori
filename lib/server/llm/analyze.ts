import { getArcs, getEntities, getEpisodesUpTo } from "../works";
import { normalizeText } from "../claims";
import { applyNameCorrections, findNameCorrections, unknownKatakanaWords } from "../names";
import type { NameCorrection, QuestionType, UserMessageAnalysis } from "../types";

/**
 * Local, deterministic analysis of the user's message. This used to be an
 * LLM call; keyword matching against the work's entities/arcs is enough for
 * what the pipeline does with the result (retrieval keywords + a coarse
 * question type), and it removes one billed request per turn.
 *
 * Only data visible at the user's viewing progress is used for event
 * matching so that no future episode title can leak through here.
 */

const DOUBT = /嘘|うそ|ウソ|ほんと(う)?[にか？?]|本当[にか？?]|マジ[で？?]|でたらめ|デタラメ|捏造|適当(に|なこと)|そんな(の|こと)(ない|なかった|あった[？?])|違う(よ|でしょ|んじゃ)|ソース|出典|どこ情報|見た覚え|記憶にない|覚えてない/;
const MEMORY_CHECK = /覚えて|だっけ|だったよね|あったよね|してたよね/;
const THEORY = /と思う|んじゃない|説|考察|伏線|かもしれない|気がする|なのでは/;
const FACT_QUESTION = /[？?]|なんで|なぜ|どうして|どういう|誰|何|いつ|どこ|教えて/;
const IMPRESSION = /好き|良かった|よかった|泣|面白|おもしろ|かわい|可愛|最高|つらい|辛い|怖|しんどい|感動|嫌い|苦手/;

const POSITIVE = /好き|良かった|よかった|面白|おもしろ|かわい|可愛|最高|感動|笑|癒/;
const NEGATIVE = /嫌い|苦手|つらい|辛い|怖|しんどい|微妙|退屈|嫌/;

function classify(text: string): QuestionType {
  if (DOUBT.test(text)) return "doubt";
  if (MEMORY_CHECK.test(text)) return "memory_check";
  if (THEORY.test(text)) return "theory";
  if (FACT_QUESTION.test(text)) return "fact_question";
  if (IMPRESSION.test(text)) return "impression";
  return "other";
}

function sentimentOf(text: string): string {
  const pos = POSITIVE.test(text);
  const neg = NEGATIVE.test(text);
  if (pos && !neg) return "positive";
  if (neg && !pos) return "negative";
  if (pos && neg) return "mixed";
  return "neutral";
}

/**
 * 登場人物の名前の誤字（「ハコワレ」→ ハチワレ）を見つけ、正式名に直した発話も返す。
 * 資料の検索・本物の設定の取り出しには直した文を使い、シオリには元の文を渡す（誤字を聞き返せるように）。
 * issue #1 ナックルベンチ。
 */
export function correctUserMessage(workId: string, userMessage: string): { text: string; corrections: NameCorrection[] } {
  const corrections = findNameCorrections(getEntities(workId), userMessage);
  return { text: applyNameCorrections(userMessage, corrections), corrections };
}

export function analyzeUserMessage(params: {
  workId: string;
  currentEpisode: number;
  userMessage: string;
  /** 作品名。見知らぬ語の判定で作品名（とその一部）を除くため。省略可 */
  workTitle?: string;
}): UserMessageAnalysis {
  const { workId, currentEpisode, userMessage, workTitle = "" } = params;
  const corrected = correctUserMessage(workId, userMessage);
  const text = normalizeText(corrected.text);

  const mentionedCharacters: string[] = [];
  for (const entity of getEntities(workId)) {
    const forms = [entity.name, ...entity.aliases].map(normalizeText).filter((f) => f.length > 0);
    if (forms.some((form) => text.includes(form))) mentionedCharacters.push(entity.name);
  }

  const mentionedEvents: string[] = [];
  for (const arc of getArcs(workId)) {
    if (arc.episodeFrom > currentEpisode) continue;
    const forms = [arc.title, ...arc.aliases].map(normalizeText).filter((f) => f.length >= 2);
    if (forms.some((form) => text.includes(form))) mentionedEvents.push(arc.title);
  }
  for (const episode of getEpisodesUpTo(workId, currentEpisode)) {
    const title = episode.title ? normalizeText(episode.title) : "";
    if (title.length >= 2 && text.includes(title)) mentionedEvents.push(episode.title!);
  }

  const unknownNames = unknownKatakanaWords({
    userMessage,
    entities: getEntities(workId),
    arcs: getArcs(workId),
    workTitle,
    corrections: corrected.corrections,
  });

  return {
    mentionedCharacters,
    mentionedEvents: Array.from(new Set(mentionedEvents)),
    sentiment: sentimentOf(userMessage),
    questionType: classify(userMessage),
    nameCorrections: corrected.corrections,
    unknownNames,
  };
}

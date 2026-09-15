import { getFabricatedFacts } from "./store";
import { getEntities } from "./works";
import { buildRevealGraph } from "./reveal/graph";
import type { RevealGraph, RevealStatement } from "./reveal/types";

/**
 * セッションに溜まっている嘘を、答え合わせと同じ構造図の形にする。
 * 会話の途中でも描けるので、開発者モードのパネルが「育つ嘘のグラフ」に使う。
 *
 * 答え合わせは発話ごとの claims（本当も含む）を並べるが、こちらは保存済みの嘘だけ。
 * どれも嘘なので verdict は lie 固定で、としおの発話は載せない。
 */
export function buildLieGraph(sessionId: string, workId: string): RevealGraph {
  const facts = getFabricatedFacts(sessionId).filter((f) => f.status === "active");
  const statements: RevealStatement[] = facts.map((f) => ({
    id: f.id,
    messageId: f.introducedMessageId,
    verdict: "lie",
    claim: f.claim,
    subject: f.subject,
    relation: f.relation,
    object: f.object,
    negated: f.negated,
    quote: null,
    sources: [],
  }));
  return buildRevealGraph({ statements, messages: [] }, getEntities(workId));
}

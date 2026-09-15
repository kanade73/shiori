import { readSse } from "./sse";
import type { CanonFact, ChatSession, FabricatedFact, Message, ProgressResolution, ResponseStrategy, Speaker, Work } from "@/lib/server/types";
import type { RevealData, Verdict } from "@/lib/server/reveal/types";

export type SessionSummary = ChatSession & { fabricatedFactCount: number };

export type SessionData = {
  session: ChatSession;
  work: Work;
  messages: Message[];
  fabricatedFactCount: number;
};

export type EnrichedFabricatedFact = FabricatedFact & {
  sourceCanonFacts: CanonFact[];
  introducedMessage: Message | null;
};

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function listWorks(): Promise<Work[]> {
  const res = await fetch("/api/works");
  const { works } = await asJson<{ works: Work[] }>(res);
  return works;
}

export async function listSessions(workId: string): Promise<SessionSummary[]> {
  const res = await fetch(`/api/sessions?workId=${encodeURIComponent(workId)}`);
  const { sessions } = await asJson<{ sessions: SessionSummary[] }>(res);
  return sessions;
}

export async function createSession(
  workId: string,
  currentEpisode: number,
  progressDescription?: string,
): Promise<{ sessionId: string; openingMessage: string }> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workId, currentEpisode, progressDescription }),
  });
  return asJson(res);
}

export async function resolveProgress(workId: string, description: string): Promise<ProgressResolution> {
  const res = await fetch(`/api/works/${encodeURIComponent(workId)}/resolve-progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  return asJson(res);
}

export async function getSessionData(sessionId: string): Promise<SessionData> {
  const res = await fetch(`/api/sessions/${sessionId}`);
  return asJson(res);
}

export async function updateEpisode(sessionId: string, currentEpisode: number): Promise<ChatSession> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentEpisode }),
  });
  const { session } = await asJson<{ session: ChatSession }>(res);
  return session;
}

export async function getFabricatedFacts(sessionId: string): Promise<EnrichedFabricatedFact[]> {
  const res = await fetch(`/api/sessions/${sessionId}/fabricated-facts`);
  const { fabricatedFacts } = await asJson<{ fabricatedFacts: EnrichedFabricatedFact[] }>(res);
  return fabricatedFacts;
}

export async function getSessionCanonFacts(sessionId: string): Promise<CanonFact[]> {
  const res = await fetch(`/api/sessions/${sessionId}/canon-facts`);
  const { canonFacts } = await asJson<{ canonFacts: CanonFact[] }>(res);
  return canonFacts;
}

export type FabricatedGraph = {
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; relation: string }[];
};

export async function getFabricatedGraph(sessionId: string): Promise<FabricatedGraph> {
  const res = await fetch(`/api/sessions/${sessionId}/fabricated-graph`);
  return asJson(res);
}

/** 答え合わせ前は問題だけ、答え合わせ後は真偽つきの会話が返る */
export async function getReveal(sessionId: string): Promise<RevealData> {
  const res = await fetch(`/api/sessions/${sessionId}/reveal`);
  return asJson(res);
}

/** 予想を送って答え合わせする。これでセッションは終わり（以後メッセージは送れない） */
export async function submitReveal(sessionId: string, guesses: Record<string, Verdict>): Promise<RevealData> {
  const res = await fetch(`/api/sessions/${sessionId}/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guesses }),
  });
  return asJson(res);
}

export type SendMessageHandlers = {
  /** シオリ・としお、どちらの発話が始まったか。以降の onToken はこの発話に属する。 */
  onMessageStart: (speaker: Speaker) => void;
  onToken: (text: string) => void;
  onMetadata: (data: { fabricatedFactIds: string[]; strategy: ResponseStrategy; regenerated: boolean }) => void;
  onMessageEnd: () => void;
  onDone: () => void;
};

export async function sendMessage(sessionId: string, content: string, handlers: SendMessageHandlers): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `request failed (${res.status})`);
  }

  for await (const { event, data } of readSse(res)) {
    if (event === "message-start") handlers.onMessageStart((data as { speaker: Speaker }).speaker);
    else if (event === "token") handlers.onToken((data as { text: string }).text);
    else if (event === "metadata")
      handlers.onMetadata(data as { fabricatedFactIds: string[]; strategy: ResponseStrategy; regenerated: boolean });
    else if (event === "message-end") handlers.onMessageEnd();
    else if (event === "done") handlers.onDone();
  }
}

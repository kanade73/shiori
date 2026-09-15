import { readSse } from "./sse";
import type {
  ChatSession,
  Message,
  ResponseStrategy,
  SessionPhase,
  SessionTopic,
  Speaker,
  Work,
} from "@/lib/server/types";
import type { RevealData } from "@/lib/server/reveal/types";

export type SessionSummary = ChatSession & { fabricatedFactCount: number };

export type SessionData = {
  session: ChatSession;
  work: Work;
  messages: Message[];
  fabricatedFactCount: number;
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

/** 話数は聞かない。シオリの「今日は何について話したい?」から始まる（issue #14） */
export async function createSession(workId: string): Promise<{ sessionId: string; openingMessage: string }> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workId }),
  });
  return asJson(res);
}

export async function getSessionData(sessionId: string): Promise<SessionData> {
  const res = await fetch(`/api/sessions/${sessionId}`);
  return asJson(res);
}

/** セッションを履歴（メッセージ・嘘）ごと消す。元には戻せない */
export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
  await asJson(res);
}

/**
 * 答え合わせをして、真偽つきの会話を受け取る。これでセッションは終わり（以後メッセージは送れない）。
 * 予想は取らない。答え合わせ済みなら、そのときの結果が返る
 */
export async function revealSession(sessionId: string): Promise<Extract<RevealData, { status: "revealed" }>> {
  const res = await fetch(`/api/sessions/${sessionId}/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guesses: {} }),
  });
  return asJson(res);
}

export type SendMessageHandlers = {
  /** シオリ・としお、どちらの発話が始まったか。以降の onToken はこの発話に属する。 */
  onMessageStart: (speaker: Speaker) => void;
  onToken: (text: string) => void;
  onMetadata: (data: { fabricatedFactIds: string[]; strategy: ResponseStrategy; regenerated: boolean }) => void;
  onMessageEnd: () => void;
  /** `phase` はセッションに嘘がどれだけ積み上がったか。終盤（"late"）の検出用に流しているだけで、UI は未実装。 */
  onDone: (data: { phase: SessionPhase }) => void;
  /** 会話の最初の返答で、話題の場面が決まった（issue #14） */
  onTopic?: (topic: SessionTopic) => void;
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
    else if (event === "topic") handlers.onTopic?.(data as SessionTopic);
    else if (event === "done") handlers.onDone({ phase: (data as { phase?: SessionPhase }).phase ?? "early" });
  }
}

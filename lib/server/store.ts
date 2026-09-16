import type { StoreBackend } from "./store-backend";
import { supabaseBackend } from "./store-supabase";
import type {
  ChatSession,
  Claim,
  FabricatedFact,
  FabricatedRelation,
  Message,
  SessionTopic,
  ShioriExpression,
  Speaker,
  StoredClaim,
} from "./types";
import type { Verdict } from "./reveal/types";

/**
 * セッション・発話・嘘・主張の永続化。置き場所は Supabase（supabase/schema.sql）で、
 * 行の出し入れは store-backend.ts の StoreBackend が受け持つ。ここに書くのは
 * 「セッションとしてどう振る舞うか」だけ: id の採番、話題が切り替わったときの退避、
 * 答え合わせは1回きり、削除の連鎖。
 */

let backend: StoreBackend = supabaseBackend;

/** テスト用。store-memory.ts の memoryBackend() を差し込む */
export function setStoreBackend(next: StoreBackend) {
  backend = next;
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

// --- Sessions ---

/** 話題の場面が決まるまでは、ネタバレ境界は 0（話数では何も開けない） */
export async function createSession(workId: string): Promise<ChatSession> {
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: newId("session"),
    workId,
    currentEpisode: 0,
    createdAt: now,
    updatedAt: now,
  };
  await backend.putSession(session);
  return session;
}

export async function getSession(sessionId: string): Promise<ChatSession | null> {
  return backend.getSession(sessionId);
}

/**
 * 話題の場面と、そこから分かったネタバレ境界を保存する（issue #14）。既に話題があれば、それは
 * pastTopics に移して新しい話題に切り替える（途中の話題の切り替わり）。境界は広げる方向にしか動かさない。
 */
export async function setSessionTopic(
  sessionId: string,
  topic: SessionTopic | null,
  currentEpisode: number,
): Promise<ChatSession | null> {
  const session = await backend.getSession(sessionId);
  if (!session) return null;
  if (topic) {
    if (session.topic) session.pastTopics = [...(session.pastTopics ?? []), session.topic];
    session.topic = topic;
  }
  session.currentEpisode = Math.max(session.currentEpisode, currentEpisode);
  session.updatedAt = new Date().toISOString();
  await backend.putSession(session);
  return session;
}

export async function touchSession(sessionId: string): Promise<void> {
  const session = await backend.getSession(sessionId);
  if (!session) return;
  session.updatedAt = new Date().toISOString();
  await backend.putSession(session);
}

/** 答え合わせ済みにする。既に済んでいれば最初の予想を残してそのまま返す。 */
export async function revealSession(sessionId: string, guesses: Record<string, Verdict>): Promise<ChatSession | null> {
  const session = await backend.getSession(sessionId);
  if (!session) return null;
  if (session.reveal) return session;
  const now = new Date().toISOString();
  session.reveal = { revealedAt: now, guesses };
  session.updatedAt = now;
  await backend.putSession(session);
  return session;
}

/** セッションと、それに属するメッセージ・嘘・主張の記録をまとめて消す。無ければ false */
export async function deleteSession(sessionId: string): Promise<boolean> {
  return backend.deleteSession(sessionId);
}

export async function listSessions(workId?: string): Promise<ChatSession[]> {
  return backend.listSessions(workId);
}

// --- Messages ---

export async function getMessages(sessionId: string): Promise<Message[]> {
  return backend.listMessages(sessionId);
}

export async function appendMessage(
  sessionId: string,
  role: Message["role"],
  content: string,
  speaker?: Speaker,
  expression?: ShioriExpression,
): Promise<Message> {
  const message: Message = {
    id: newId("msg"),
    sessionId,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(speaker ? { speaker } : {}),
    ...(expression ? { expression } : {}),
  };
  await backend.addMessage(message);

  const session = await backend.getSession(sessionId);
  if (session) {
    session.updatedAt = message.createdAt;
    await backend.putSession(session);
  }
  return message;
}

// --- Message claims ---

/** シオリの発話が述べた主張を、真偽ごと保存する（答え合わせで使う）。主張が無い発話も空で記録する。 */
export async function saveMessageClaims(sessionId: string, messageId: string, claims: Claim[]): Promise<StoredClaim[]> {
  const stored = claims.map((c) => ({ ...c, id: newId("claim") }));
  await backend.putMessageClaims(sessionId, messageId, stored);
  return stored;
}

export async function getMessageClaims(sessionId: string): Promise<Record<string, StoredClaim[]>> {
  return backend.listMessageClaims(sessionId);
}

// --- Fabricated facts ---

export async function getFabricatedFacts(sessionId: string): Promise<FabricatedFact[]> {
  return backend.listFabricatedFacts(sessionId);
}

export async function addFabricatedFact(
  input: Omit<FabricatedFact, "id" | "createdAt" | "status"> & { status?: FabricatedFact["status"] },
): Promise<FabricatedFact> {
  const fact: FabricatedFact = {
    ...input,
    id: newId("fake"),
    status: input.status ?? "active",
    createdAt: new Date().toISOString(),
  };
  await backend.addFabricatedFact(fact);
  return fact;
}

// --- Fabricated relations ---

export async function getFabricatedRelations(sessionId: string): Promise<FabricatedRelation[]> {
  const facts = new Set((await getFabricatedFacts(sessionId)).map((f) => f.id));
  const relations = await backend.listFabricatedRelations(sessionId);
  return relations.filter((rel) => facts.has(rel.fromFactId) && facts.has(rel.toFactId));
}

export async function addFabricatedRelation(
  sessionId: string,
  input: Omit<FabricatedRelation, "id">,
): Promise<FabricatedRelation> {
  const relation: FabricatedRelation = { ...input, id: newId("rel") };
  await backend.addFabricatedRelation(sessionId, relation);
  return relation;
}

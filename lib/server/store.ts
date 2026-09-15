import fs from "node:fs";
import path from "node:path";
import type {
  ChatSession,
  Claim,
  FabricatedFact,
  FabricatedRelation,
  Message,
  SessionTopic,
  Speaker,
  StoredClaim,
  Verdict,
} from "./types";

type Db = {
  sessions: Record<string, ChatSession>;
  messages: Record<string, Message[]>;
  fabricatedFacts: Record<string, FabricatedFact[]>;
  fabricatedRelations: Record<string, FabricatedRelation[]>;
  /** sessionId → messageId → その発話の claims。答え合わせ用 */
  messageClaims: Record<string, Record<string, StoredClaim[]>>;
};

// DATA_DIR で永続化先を差し替えられる（コンテナではボリュームのマウント先を指す）
const DB_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");

/** 永続化先のディレクトリ。db.json 以外のキャッシュ（埋め込みなど）もここに置く */
export function dataDir(): string {
  return DB_DIR;
}
const DB_PATH = path.join(DB_DIR, "db.json");

function emptyDb(): Db {
  return { sessions: {}, messages: {}, fabricatedFacts: {}, fabricatedRelations: {}, messageClaims: {} };
}

function readDb(): Db {
  if (!fs.existsSync(DB_PATH)) return emptyDb();
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return { ...emptyDb(), ...JSON.parse(raw) };
  } catch {
    return emptyDb();
  }
}

function writeDb(db: Db) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

// --- Sessions ---

/** 話題の場面が決まるまでは、ネタバレ境界は 0（話数では何も開けない） */
export function createSession(workId: string): ChatSession {
  const db = readDb();
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: newId("session"),
    workId,
    currentEpisode: 0,
    createdAt: now,
    updatedAt: now,
  };
  db.sessions[session.id] = session;
  db.messages[session.id] = [];
  db.fabricatedFacts[session.id] = [];
  writeDb(db);
  return session;
}

export function getSession(sessionId: string): ChatSession | null {
  return readDb().sessions[sessionId] ?? null;
}

/**
 * 話題の場面と、そこから分かったネタバレ境界を保存する（issue #14）。既に話題があれば、それは
 * pastTopics に移して新しい話題に切り替える（途中の話題の切り替わり）。境界は広げる方向にしか動かさない。
 */
export function setSessionTopic(sessionId: string, topic: SessionTopic | null, currentEpisode: number): ChatSession | null {
  const db = readDb();
  const session = db.sessions[sessionId];
  if (!session) return null;
  if (topic) {
    if (session.topic) session.pastTopics = [...(session.pastTopics ?? []), session.topic];
    session.topic = topic;
  }
  session.currentEpisode = Math.max(session.currentEpisode, currentEpisode);
  session.updatedAt = new Date().toISOString();
  writeDb(db);
  return session;
}

export function touchSession(sessionId: string) {
  const db = readDb();
  const session = db.sessions[sessionId];
  if (!session) return;
  session.updatedAt = new Date().toISOString();
  writeDb(db);
}

/** 答え合わせ済みにする。既に済んでいれば最初の予想を残してそのまま返す。 */
export function revealSession(sessionId: string, guesses: Record<string, Verdict>): ChatSession | null {
  const db = readDb();
  const session = db.sessions[sessionId];
  if (!session) return null;
  if (session.reveal) return session;
  const now = new Date().toISOString();
  session.reveal = { revealedAt: now, guesses };
  session.updatedAt = now;
  writeDb(db);
  return session;
}

export function listSessions(workId?: string): ChatSession[] {
  const db = readDb();
  const all = Object.values(db.sessions);
  const filtered = workId ? all.filter((s) => s.workId === workId) : all;
  return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// --- Messages ---

export function getMessages(sessionId: string): Message[] {
  return readDb().messages[sessionId] ?? [];
}

export function appendMessage(sessionId: string, role: Message["role"], content: string, speaker?: Speaker): Message {
  const db = readDb();
  const message: Message = {
    id: newId("msg"),
    sessionId,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(speaker ? { speaker } : {}),
  };
  if (!db.messages[sessionId]) db.messages[sessionId] = [];
  db.messages[sessionId].push(message);
  if (db.sessions[sessionId]) db.sessions[sessionId].updatedAt = message.createdAt;
  writeDb(db);
  return message;
}

// --- Message claims ---

/** シオリの発話が述べた主張を、真偽ごと保存する（答え合わせで使う）。主張が無い発話も空で記録する。 */
export function saveMessageClaims(sessionId: string, messageId: string, claims: Claim[]): StoredClaim[] {
  const db = readDb();
  const stored = claims.map((c) => ({ ...c, id: newId("claim") }));
  if (!db.messageClaims[sessionId]) db.messageClaims[sessionId] = {};
  db.messageClaims[sessionId][messageId] = stored;
  writeDb(db);
  return stored;
}

export function getMessageClaims(sessionId: string): Record<string, StoredClaim[]> {
  return readDb().messageClaims[sessionId] ?? {};
}

// --- Fabricated facts ---

export function getFabricatedFacts(sessionId: string): FabricatedFact[] {
  return readDb().fabricatedFacts[sessionId] ?? [];
}

export function addFabricatedFact(
  input: Omit<FabricatedFact, "id" | "createdAt" | "status"> & { status?: FabricatedFact["status"] },
): FabricatedFact {
  const db = readDb();
  const fact: FabricatedFact = {
    ...input,
    id: newId("fake"),
    status: input.status ?? "active",
    createdAt: new Date().toISOString(),
  };
  if (!db.fabricatedFacts[input.sessionId]) db.fabricatedFacts[input.sessionId] = [];
  db.fabricatedFacts[input.sessionId].push(fact);
  writeDb(db);
  return fact;
}

// --- Fabricated relations ---

export function getFabricatedRelations(sessionId: string): FabricatedRelation[] {
  const facts = new Set(getFabricatedFacts(sessionId).map((f) => f.id));
  const db = readDb();
  return (db.fabricatedRelations[sessionId] ?? []).filter(
    (rel) => facts.has(rel.fromFactId) && facts.has(rel.toFactId),
  );
}

export function addFabricatedRelation(sessionId: string, input: Omit<FabricatedRelation, "id">): FabricatedRelation {
  const db = readDb();
  const relation: FabricatedRelation = { ...input, id: newId("rel") };
  if (!db.fabricatedRelations[sessionId]) db.fabricatedRelations[sessionId] = [];
  db.fabricatedRelations[sessionId].push(relation);
  writeDb(db);
  return relation;
}

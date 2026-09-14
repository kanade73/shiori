import fs from "node:fs";
import path from "node:path";
import type { ChatSession, FabricatedFact, FabricatedRelation, Message } from "./types";

type Db = {
  sessions: Record<string, ChatSession>;
  messages: Record<string, Message[]>;
  fabricatedFacts: Record<string, FabricatedFact[]>;
  fabricatedRelations: Record<string, FabricatedRelation[]>;
};

// DATA_DIR で永続化先を差し替えられる（コンテナではボリュームのマウント先を指す）
const DB_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const DB_PATH = path.join(DB_DIR, "db.json");

function emptyDb(): Db {
  return { sessions: {}, messages: {}, fabricatedFacts: {}, fabricatedRelations: {} };
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

export function createSession(workId: string, currentEpisode: number, progressDescription?: string): ChatSession {
  const db = readDb();
  const now = new Date().toISOString();
  const session: ChatSession = {
    id: newId("session"),
    workId,
    currentEpisode,
    ...(progressDescription ? { progressDescription } : {}),
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

export function updateSessionEpisode(sessionId: string, currentEpisode: number): ChatSession | null {
  const db = readDb();
  const session = db.sessions[sessionId];
  if (!session) return null;
  session.currentEpisode = currentEpisode;
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

export function appendMessage(sessionId: string, role: Message["role"], content: string): Message {
  const db = readDb();
  const message: Message = {
    id: newId("msg"),
    sessionId,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
  if (!db.messages[sessionId]) db.messages[sessionId] = [];
  db.messages[sessionId].push(message);
  if (db.sessions[sessionId]) db.sessions[sessionId].updatedAt = message.createdAt;
  writeDb(db);
  return message;
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

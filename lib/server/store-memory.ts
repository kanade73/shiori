import type { StoreBackend } from "./store-backend";
import type { ChatSession, FabricatedFact, FabricatedRelation, Message, StoredClaim } from "./types";

/**
 * **テスト専用**の StoreBackend。本番の経路は store-supabase.ts の1本だけで、これは
 * store.ts の意味論（話題の入れ替え・答え合わせは1回きり・削除の連鎖）を
 * ネットワーク無しで回すためだけに置いてある。アプリのコードから使わないこと。
 *
 * 使い方: `setStoreBackend(memoryBackend())` を beforeEach で呼ぶ。
 */
export function memoryBackend(): StoreBackend {
  const sessions = new Map<string, ChatSession>();
  const messages = new Map<string, Message[]>();
  const claims = new Map<string, Map<string, StoredClaim[]>>();
  const facts = new Map<string, FabricatedFact[]>();
  const relations = new Map<string, FabricatedRelation[]>();

  // 呼び出し側が持ち帰った値を書き換えても DB の中身が変わらないよう、出し入れで写しを取る
  const copy = <T>(value: T): T => structuredClone(value);

  return {
    async getSession(sessionId) {
      const session = sessions.get(sessionId);
      return session ? copy(session) : null;
    },

    async putSession(session) {
      sessions.set(session.id, copy(session));
    },

    async listSessions(workId) {
      return [...sessions.values()]
        .filter((s) => !workId || s.workId === workId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(copy);
    },

    async deleteSession(sessionId) {
      if (!sessions.has(sessionId)) return false;
      sessions.delete(sessionId);
      messages.delete(sessionId);
      claims.delete(sessionId);
      facts.delete(sessionId);
      relations.delete(sessionId);
      return true;
    },

    async listMessages(sessionId) {
      return (messages.get(sessionId) ?? []).map(copy);
    },

    async addMessage(message) {
      const list = messages.get(message.sessionId) ?? [];
      list.push(copy(message));
      messages.set(message.sessionId, list);
    },

    async listMessageClaims(sessionId) {
      const byMessage = claims.get(sessionId);
      if (!byMessage) return {};
      return Object.fromEntries([...byMessage].map(([id, list]) => [id, list.map(copy)]));
    },

    async putMessageClaims(sessionId, messageId, list) {
      const byMessage = claims.get(sessionId) ?? new Map<string, StoredClaim[]>();
      byMessage.set(messageId, list.map(copy));
      claims.set(sessionId, byMessage);
    },

    async listFabricatedFacts(sessionId) {
      return (facts.get(sessionId) ?? []).map(copy);
    },

    async addFabricatedFact(fact) {
      const list = facts.get(fact.sessionId) ?? [];
      list.push(copy(fact));
      facts.set(fact.sessionId, list);
    },

    async listFabricatedRelations(sessionId) {
      return (relations.get(sessionId) ?? []).map(copy);
    },

    async addFabricatedRelation(sessionId, relation) {
      const list = relations.get(sessionId) ?? [];
      list.push(copy(relation));
      relations.set(sessionId, list);
    },
  };
}

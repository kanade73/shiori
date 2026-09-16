import type { ChatSession, FabricatedFact, FabricatedRelation, Message, StoredClaim } from "./types";

/**
 * store.ts の下にある、行の出し入れだけをする層。セッションの意味論（話題の入れ替え・
 * 答え合わせは1回きり・削除の連鎖・id の採番）は store.ts が持ち、ここはただ読み書きする。
 *
 * 本番の実装は1つだけ（store-supabase.ts）。もう1つの store-memory.ts は**テスト専用**で、
 * ネットワーク無しで store.ts の意味論を回すために置いてある。
 */
export type StoreBackend = {
  getSession(sessionId: string): Promise<ChatSession | null>;
  /** セッション1件を丸ごと入れ直す（無ければ作る） */
  putSession(session: ChatSession): Promise<void>;
  /** 更新の新しい順 */
  listSessions(workId?: string): Promise<ChatSession[]>;
  /** セッションと、それにぶら下がる発話・主張・嘘をまとめて消す。無ければ false */
  deleteSession(sessionId: string): Promise<boolean>;

  /** 保存した順 */
  listMessages(sessionId: string): Promise<Message[]>;
  addMessage(message: Message): Promise<void>;

  /** messageId → その発話の主張 */
  listMessageClaims(sessionId: string): Promise<Record<string, StoredClaim[]>>;
  putMessageClaims(sessionId: string, messageId: string, claims: StoredClaim[]): Promise<void>;

  /** 保存した順 */
  listFabricatedFacts(sessionId: string): Promise<FabricatedFact[]>;
  addFabricatedFact(fact: FabricatedFact): Promise<void>;

  listFabricatedRelations(sessionId: string): Promise<FabricatedRelation[]>;
  addFabricatedRelation(sessionId: string, relation: FabricatedRelation): Promise<void>;
};

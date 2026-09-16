import { supabase, unwrap } from "./supabase";
import type { StoreBackend } from "./store-backend";
import type {
  ChatSession,
  ClaimGrounding,
  ClaimRelation,
  FabricatedFact,
  FabricatedFactStatus,
  FabricatedRelationType,
  Message,
  SessionTopic,
  Speaker,
  StoredClaim,
} from "./types";
import type { RevealState } from "./reveal/types";

/**
 * StoreBackend の本番の実装（supabase/schema.sql のテーブル）。
 * ここがやるのは行 ↔ lib/server/types.ts の型の変換だけで、意味論は store.ts が持つ。
 *
 * 時刻は DB でも text（アプリが作った ISO 文字列がそのまま入る）。
 * 発話と嘘の並びは bigserial の seq で決める（同じミリ秒に2件入っても順が崩れない）。
 */

type SessionRow = {
  id: string;
  work_id: string;
  current_episode: number;
  topic: SessionTopic | null;
  past_topics: SessionTopic[] | null;
  reveal: RevealState | null;
  progress_description: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: Message["role"];
  speaker: Speaker | null;
  content: string;
  created_at: string;
};

type ClaimRow = {
  id: string;
  session_id: string;
  message_id: string;
  ord: number;
  subject: string;
  relation: ClaimRelation;
  object: string;
  negated: boolean;
  claim: string;
  quote: string | null;
  grounding: ClaimGrounding;
  source_canon_fact_ids: string[];
};

type FactRow = {
  id: string;
  session_id: string;
  subject: string;
  relation: ClaimRelation;
  object: string;
  negated: boolean;
  claim: string;
  source_canon_fact_ids: string[];
  introduced_message_id: string;
  confidence: number;
  status: FabricatedFactStatus;
  created_at: string;
};

type RelationRow = {
  id: string;
  session_id: string;
  from_fact_id: string;
  to_fact_id: string;
  relation: FabricatedRelationType;
};

const SESSION_COLUMNS =
  "id, work_id, current_episode, topic, past_topics, reveal, progress_description, created_at, updated_at";

function toSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    workId: row.work_id,
    currentEpisode: row.current_episode,
    // 無い値は列では null、型では undefined。往復しても形が変わらないよう落とす
    ...(row.topic ? { topic: row.topic } : {}),
    ...(row.past_topics && row.past_topics.length > 0 ? { pastTopics: row.past_topics } : {}),
    ...(row.reveal ? { reveal: row.reveal } : {}),
    ...(row.progress_description ? { progressDescription: row.progress_description } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromSession(session: ChatSession): SessionRow {
  return {
    id: session.id,
    work_id: session.workId,
    current_episode: session.currentEpisode,
    topic: session.topic ?? null,
    past_topics: session.pastTopics ?? [],
    reveal: session.reveal ?? null,
    progress_description: session.progressDescription ?? null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    ...(row.speaker ? { speaker: row.speaker } : {}),
  };
}

function toClaim(row: ClaimRow): StoredClaim {
  return {
    id: row.id,
    subject: row.subject,
    relation: row.relation,
    object: row.object,
    negated: row.negated,
    claim: row.claim,
    grounding: row.grounding,
    sourceCanonFactIds: row.source_canon_fact_ids,
    ...(row.quote ? { quote: row.quote } : {}),
  };
}

function toFact(row: FactRow): FabricatedFact {
  return {
    id: row.id,
    sessionId: row.session_id,
    subject: row.subject,
    relation: row.relation,
    object: row.object,
    negated: row.negated,
    claim: row.claim,
    sourceCanonFactIds: row.source_canon_fact_ids,
    introducedMessageId: row.introduced_message_id,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
  };
}

export const supabaseBackend: StoreBackend = {
  async getSession(sessionId) {
    const { data, error } = await supabase()
      .from("sessions")
      .select(SESSION_COLUMNS)
      .eq("id", sessionId)
      .maybeSingle<SessionRow>();
    if (error) throw new Error(`セッションの取得に失敗: ${error.message}`);
    return data ? toSession(data) : null;
  },

  async putSession(session) {
    const { error } = await supabase().from("sessions").upsert(fromSession(session));
    if (error) throw new Error(`セッションの保存に失敗: ${error.message}`);
  },

  async listSessions(workId) {
    const query = supabase().from("sessions").select(SESSION_COLUMNS).order("updated_at", { ascending: false });
    const rows = unwrap(await (workId ? query.eq("work_id", workId) : query), "セッション一覧の取得に失敗");
    return (rows as SessionRow[]).map(toSession);
  },

  async deleteSession(sessionId) {
    // 発話・主張・嘘は外部キーの on delete cascade で一緒に消える（supabase/schema.sql）
    const rows = unwrap(
      await supabase().from("sessions").delete().eq("id", sessionId).select("id"),
      "セッションの削除に失敗",
    );
    return (rows as { id: string }[]).length > 0;
  },

  async listMessages(sessionId) {
    const rows = unwrap(
      await supabase()
        .from("messages")
        .select("id, session_id, role, speaker, content, created_at")
        .eq("session_id", sessionId)
        .order("seq", { ascending: true }),
      "発話の取得に失敗",
    );
    return (rows as MessageRow[]).map(toMessage);
  },

  async addMessage(message) {
    const { error } = await supabase().from("messages").insert({
      id: message.id,
      session_id: message.sessionId,
      role: message.role,
      speaker: message.speaker ?? null,
      content: message.content,
      created_at: message.createdAt,
    });
    if (error) throw new Error(`発話の保存に失敗: ${error.message}`);
  },

  async listMessageClaims(sessionId) {
    const rows = unwrap(
      await supabase()
        .from("message_claims")
        .select("id, session_id, message_id, ord, subject, relation, object, negated, claim, quote, grounding, source_canon_fact_ids")
        .eq("session_id", sessionId)
        .order("ord", { ascending: true }),
      "主張の取得に失敗",
    );
    const byMessage: Record<string, StoredClaim[]> = {};
    for (const row of rows as ClaimRow[]) {
      (byMessage[row.message_id] ??= []).push(toClaim(row));
    }
    return byMessage;
  },

  async putMessageClaims(sessionId, messageId, claims) {
    // 同じ発話の主張は入れ直し（再生成でやり直したときに古い行を残さない）
    const { error: removed } = await supabase().from("message_claims").delete().eq("message_id", messageId);
    if (removed) throw new Error(`主張の入れ直しに失敗: ${removed.message}`);
    if (claims.length === 0) return;

    const { error } = await supabase()
      .from("message_claims")
      .insert(
        claims.map((claim, ord) => ({
          id: claim.id,
          session_id: sessionId,
          message_id: messageId,
          ord,
          subject: claim.subject,
          relation: claim.relation,
          object: claim.object,
          negated: claim.negated,
          claim: claim.claim,
          quote: claim.quote ?? null,
          grounding: claim.grounding,
          source_canon_fact_ids: claim.sourceCanonFactIds,
        })),
      );
    if (error) throw new Error(`主張の保存に失敗: ${error.message}`);
  },

  async listFabricatedFacts(sessionId) {
    const rows = unwrap(
      await supabase()
        .from("fabricated_facts")
        .select(
          "id, session_id, subject, relation, object, negated, claim, source_canon_fact_ids, introduced_message_id, confidence, status, created_at",
        )
        .eq("session_id", sessionId)
        .order("seq", { ascending: true }),
      "嘘の取得に失敗",
    );
    return (rows as FactRow[]).map(toFact);
  },

  async addFabricatedFact(fact) {
    const { error } = await supabase().from("fabricated_facts").insert({
      id: fact.id,
      session_id: fact.sessionId,
      subject: fact.subject,
      relation: fact.relation,
      object: fact.object,
      negated: fact.negated,
      claim: fact.claim,
      source_canon_fact_ids: fact.sourceCanonFactIds,
      introduced_message_id: fact.introducedMessageId,
      confidence: fact.confidence,
      status: fact.status,
      created_at: fact.createdAt,
    });
    if (error) throw new Error(`嘘の保存に失敗: ${error.message}`);
  },

  async listFabricatedRelations(sessionId) {
    const rows = unwrap(
      await supabase()
        .from("fabricated_relations")
        .select("id, session_id, from_fact_id, to_fact_id, relation")
        .eq("session_id", sessionId),
      "嘘のつながりの取得に失敗",
    );
    return (rows as RelationRow[]).map((row) => ({
      id: row.id,
      fromFactId: row.from_fact_id,
      toFactId: row.to_fact_id,
      relation: row.relation,
    }));
  },

  async addFabricatedRelation(sessionId, relation) {
    const { error } = await supabase().from("fabricated_relations").insert({
      id: relation.id,
      session_id: sessionId,
      from_fact_id: relation.fromFactId,
      to_fact_id: relation.toFactId,
      relation: relation.relation,
    });
    if (error) throw new Error(`嘘のつながりの保存に失敗: ${error.message}`);
  },
};

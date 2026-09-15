import type { ClaimRelation, Speaker } from "../types";

/**
 * 答え合わせ（会話の終わりに、シオリととしおの話の真偽を明かす）の型。
 * ChatSession.reveal に保存する RevealState 以外は API のレスポンス専用で、db.json には入らない。
 */

export type Verdict = "true" | "lie";

export type RevealState = {
  revealedAt: string;
  /** statement id → ユーザーの予想。予想しなかったものは含まない */
  guesses: Record<string, Verdict>;
};

/** 答え合わせの対象になる主張1件。今のところシオリの claims だけ（としおの発言は主張を記録していない）。 */
export type RevealStatement = {
  id: string;
  messageId: string;
  verdict: Verdict;
  claim: string;
  /** 主張の三つ組（嘘の構造図で、同じ主語・目的語をつなぐのに使う） */
  subject: string;
  relation: ClaimRelation;
  object: string;
  negated: boolean;
  /** 返答文の中の該当部分。記録が無い（旧データ）なら null */
  quote: string | null;
  /** 本当の主張なら根拠、嘘なら元にした本物の設定。視聴済み範囲のものだけ */
  sources: { id: string; episodeFrom: number; description: string }[];
};

// --- 嘘の構造図（答え合わせの結果に添える、主張どうしの関係のグラフ） ---

/**
 * ノードの種類。statement は主張（本当/嘘）、entity は主張の主語・目的語になったキャラや物、
 * canon は嘘が元にした（または本当の主張の根拠になった）本物の設定、toshio はとしおの考察。
 */
export type RevealGraphNode =
  | { id: string; kind: "statement"; statementId: string; verdict: Verdict; label: string; number: number }
  | { id: string; kind: "entity"; label: string; known: boolean }
  | { id: string; kind: "canon"; label: string; episodeFrom: number }
  | { id: string; kind: "toshio"; messageId: string; label: string };

/**
 * 辺の種類。subject/object は主張とその主語・目的語、based_on は主張とそれが拠った本物の設定、
 * rode_on はとしおが（嘘だと知ったうえで）乗った主張。
 */
export type RevealGraphEdgeKind = "subject" | "object" | "based_on" | "rode_on";

export type RevealGraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: RevealGraphEdgeKind;
  /** subject/object の辺に付ける関係の語（好き・正体は 等） */
  label?: string;
};

export type RevealGraph = { nodes: RevealGraphNode[]; edges: RevealGraphEdge[] };

/** 発話本文を、主張の抜き出し位置で区切ったもの。statementId の無い部分はただの会話 */
export type RevealSegment = { text: string; statementId?: string };

export type RevealMessage = {
  id: string;
  role: "user" | "assistant";
  speaker?: Speaker;
  content: string;
  createdAt: string;
  segments: RevealSegment[];
  /** この発話の主張（本文中の位置が特定できなかったものも含む） */
  statementIds: string[];
  /** としおの発話のみ: 直前のシオリの返答でついた嘘。としおはどこが嘘かを知ったうえで話を合わせていた */
  premiseStatementIds?: string[];
};

/** 答え合わせ前に出す問題。真偽は含めない */
export type RevealQuestion = {
  id: string;
  speaker: Speaker;
  text: string;
  createdAt: string;
};

export type RevealData =
  | { status: "pending"; questions: RevealQuestion[] }
  | {
      status: "revealed";
      reveal: RevealState;
      messages: RevealMessage[];
      statements: RevealStatement[];
      /** 主張の記録を始める前のシオリの発話がある（その発話は嘘だけを、位置なしで示す） */
      hasUntrackedMessages: boolean;
      /** 主張・登場するもの・本物の設定・としおの考察のつながり */
      graph: RevealGraph;
    };

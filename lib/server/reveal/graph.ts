import { buildNormalizer } from "../claims";
import type { BuiltReveal } from "./build";
import type { ClaimRelation, Entity } from "../types";
import type { RevealGraph, RevealGraphEdge, RevealGraphNode, RevealStatement } from "./types";

/**
 * 嘘の構造図: 答え合わせの結果に添える、主張どうしのつながりのグラフ。
 *
 * つなぐのは次の4種類だけ（どれも記録から機械的に引ける関係で、推測は入れない）:
 * - 主張 ↔ 主語のキャラ・物（同じ主語の主張はこのノードで束になる）
 * - 主張 → 目的語（目的語が別の登場人物・物と一致したときだけ。「AとBは兄弟」のような横のつながり）
 * - 主張 → 元にした本物の設定（sourceCanonFactIds。嘘が本当の設定の上に乗っているのが見える）
 * - としおの考察 → 乗った嘘（premiseStatementIds）
 *
 * FabricatedRelation（supports/causes 等）は現状どこからも書かれていないので使わない。
 */

/** 関係の語（辺のラベル）。否定は「〜ない」を付ける */
export const RELATION_LABEL: Record<ClaimRelation, string> = {
  is: "は〜だ",
  identity: "正体",
  origin: "由来",
  lives_in: "住処",
  first_appeared: "初登場",
  has: "持つ",
  likes: "好き",
  dislikes: "嫌い",
  fears: "怖い",
  can: "できる",
  cannot: "できない",
  did: "した",
  related_to: "関係",
  secret: "秘密",
  other: "",
};

export function relationLabel(relation: ClaimRelation, negated: boolean): string {
  const base = RELATION_LABEL[relation] ?? "";
  if (!base) return negated ? "否定" : "";
  return negated ? `${base}（否定）` : base;
}

/** ノードに出す短い文。長い主張は途中で切る */
export function shortLabel(text: string, max = 28): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function buildRevealGraph(built: Pick<BuiltReveal, "statements" | "messages">, entities: Entity[]): RevealGraph {
  const normalize = buildNormalizer(entities);
  const knownNames = new Set(entities.map((e) => e.name));

  const nodes: RevealGraphNode[] = [];
  const edges: RevealGraphEdge[] = [];
  const entityNodeByKey = new Map<string, string>();
  const canonNodeByKey = new Map<string, string>();

  function entityNode(raw: string): string | null {
    const key = normalize(raw);
    if (!key) return null;
    const existing = entityNodeByKey.get(key);
    if (existing) return existing;
    const id = `entity:${key}`;
    // 正式名に解決できたらそれを、できなければ元の表記を表示名にする
    const label = knownNames.has(key) ? key : raw.trim();
    nodes.push({ id, kind: "entity", label, known: knownNames.has(key) });
    entityNodeByKey.set(key, id);
    return id;
  }

  function canonNode(source: RevealStatement["sources"][number]): string {
    const existing = canonNodeByKey.get(source.id);
    if (existing) return existing;
    const id = `canon:${source.id}`;
    nodes.push({ id, kind: "canon", label: source.description, episodeFrom: source.episodeFrom });
    canonNodeByKey.set(source.id, id);
    return id;
  }

  // 主語は全部ノードにする。目的語は「主語になったもの・作品の登場人物」に当たるときだけつなぐ
  const subjectKeys = new Set(built.statements.map((s) => normalize(s.subject)).filter(Boolean));

  built.statements.forEach((s, i) => {
    const sid = `statement:${s.id}`;
    nodes.push({ id: sid, kind: "statement", statementId: s.id, verdict: s.verdict, label: shortLabel(s.claim), number: i + 1 });

    const subj = entityNode(s.subject);
    if (subj) edges.push({ id: `subject:${s.id}`, from: subj, to: sid, kind: "subject", label: relationLabel(s.relation, s.negated) });

    const objKey = normalize(s.object);
    if (objKey && objKey !== normalize(s.subject) && (knownNames.has(objKey) || subjectKeys.has(objKey))) {
      const obj = entityNode(s.object);
      if (obj) edges.push({ id: `object:${s.id}`, from: sid, to: obj, kind: "object" });
    }

    for (const source of s.sources) {
      edges.push({ id: `based_on:${s.id}:${source.id}`, from: sid, to: canonNode(source), kind: "based_on" });
    }
  });

  const statementIds = new Set(built.statements.map((s) => s.id));
  let toshioCount = 0;
  for (const m of built.messages) {
    if (m.speaker !== "toshio") continue;
    const premises = (m.premiseStatementIds ?? []).filter((id) => statementIds.has(id));
    if (premises.length === 0) continue;
    toshioCount += 1;
    const tid = `toshio:${m.id}`;
    nodes.push({ id: tid, kind: "toshio", messageId: m.id, label: `としおの考察 ${toshioCount}` });
    for (const id of premises) edges.push({ id: `rode_on:${m.id}:${id}`, from: tid, to: `statement:${id}`, kind: "rode_on" });
  }

  return { nodes, edges };
}

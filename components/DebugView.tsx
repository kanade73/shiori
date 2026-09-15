"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getFabricatedFacts,
  getFabricatedGraph,
  getSessionCanonFacts,
  getSessionData,
  type EnrichedFabricatedFact,
  type FabricatedGraph,
} from "@/lib/client/api";
import { episodeFromLabel, sessionLabel } from "@/lib/client/types";
import type { CanonFact, ChatSession, Work } from "@/lib/server/types";

const STATUS_LABEL: Record<string, string> = {
  active: "有効",
  contradicted: "矛盾あり",
  retired: "無効",
};

function relatedLabelsFor(factId: string, facts: EnrichedFabricatedFact[], graph: FabricatedGraph | null): string[] {
  if (!graph) return [];
  return graph.edges
    .filter((e) => e.from === factId || e.to === factId)
    .map((e) => {
      const otherId = e.from === factId ? e.to : e.from;
      const other = facts.find((f) => f.id === otherId);
      return `${e.relation}: ${other?.claim ?? otherId}`;
    });
}

function CanonFactCard({ fact }: { fact: CanonFact }) {
  return (
    <div className="rounded-lg border border-hairline bg-canvas px-sm py-xs">
      <p className="text-[11px] text-muted-soft">{episodeFromLabel(fact.episodeFrom)}</p>
      <p className="mt-xxs text-[14px] text-ink">
        {fact.subject} が {fact.object} に対して{fact.relation}
      </p>
      <p className="mt-xxs text-[13px] text-muted">{fact.description}</p>
    </div>
  );
}

function FabricatedFactCard({
  fact,
  related,
}: {
  fact: EnrichedFabricatedFact;
  related: string[];
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-card px-sm py-sm">
      <div className="flex items-center justify-between gap-sm">
        <p className="text-[14px] font-medium text-ink">{fact.claim}</p>
        <span className="shrink-0 rounded-pill border border-hairline bg-canvas px-xs py-[2px] text-[11px] text-muted">
          {STATUS_LABEL[fact.status] ?? fact.status}
        </span>
      </div>

      <dl className="mt-xs space-y-xxs text-[13px] text-body">
        <div>
          <dt className="inline text-muted-soft">対象: </dt>
          <dd className="inline">
            {fact.subject} / {fact.relation} / {fact.object}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-soft">元になった本物の情報: </dt>
          <dd className="inline">
            {fact.sourceCanonFacts.length > 0
              ? fact.sourceCanonFacts.map((c) => c.description).join(" / ")
              : "なし（新規の創作）"}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-soft">生成された会話: </dt>
          <dd className="inline">{fact.introducedMessage?.content ?? "（不明）"}</dd>
        </div>
        <div>
          <dt className="inline text-muted-soft">関連する別の嘘: </dt>
          <dd className="inline">{related.length > 0 ? related.join("、") : "なし"}</dd>
        </div>
        <div>
          <dt className="inline text-muted-soft">信頼度: </dt>
          <dd className="inline">{Math.round(fact.confidence * 100)}%</dd>
        </div>
      </dl>
    </div>
  );
}

export function DebugView({ sessionId }: { sessionId: string }) {
  const [work, setWork] = useState<Work | null>(null);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [canonFacts, setCanonFacts] = useState<CanonFact[]>([]);
  const [fabricatedFacts, setFabricatedFacts] = useState<EnrichedFabricatedFact[]>([]);
  const [graph, setGraph] = useState<FabricatedGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [sessionData, canon, fabricated, fabricatedGraph] = await Promise.all([
          getSessionData(sessionId),
          getSessionCanonFacts(sessionId),
          getFabricatedFacts(sessionId),
          getFabricatedGraph(sessionId),
        ]);
        if (cancelled) return;
        setWork(sessionData.work);
        setSession(sessionData.session);
        setCanonFacts(canon);
        setFabricatedFacts(fabricated);
        setGraph(fabricatedGraph);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas">
        <p className="text-[14px] text-muted">読み込み中……</p>
      </div>
    );
  }

  if (error || !work || !session) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas">
        <p className="text-[14px] text-muted">{error ?? "セッションが見つかりませんでした。"}</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-canvas px-md py-lg">
      <div className="mx-auto max-w-[760px]">
        <Link href={`/chat/${sessionId}`} className="text-[13px] text-primary hover:underline">
          ← チャットに戻る
        </Link>

        <h1 className="mt-sm font-display text-display-sm font-medium text-ink">偽設定の確認画面</h1>
        <p className="mt-xxs text-[13px] text-muted">
          {work.title} ・ {sessionLabel(session)}（
          {session.currentEpisode > 0 ? `第${session.currentEpisode}話まで視聴済みとして扱う` : "視聴話数は不明"}） ・
          開発者・デモ用の管理画面です
        </p>

        <section className="mt-lg">
          <h2 className="text-title-sm font-medium text-ink">今日の話題</h2>
          {session.topic ? (
            <div className="mt-sm rounded-lg border border-hairline bg-canvas px-sm py-xs">
              <p className="text-[14px] font-medium text-ink">{session.topic.title}</p>
              <p className="mt-xxs text-[13px] text-muted">{session.topic.summary}</p>
              <p className="mt-xs text-[12px] text-muted-soft">
                「{session.topic.query}」から特定 ・ 資料:{" "}
                {session.topic.sources.map((s, i) => (
                  <span key={s.url}>
                    {i > 0 && "、"}
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {s.title}
                    </a>
                  </span>
                ))}
              </p>
            </div>
          ) : (
            <p className="mt-sm text-[13px] text-muted">まだ特定していません（ユーザーの最初の返答から外部の資料で調べます）。</p>
          )}
        </section>

        <section className="mt-lg">
          <h2 className="text-title-sm font-medium text-ink">本当の設定（視聴済み範囲）</h2>
          <div className="mt-sm space-y-xs">
            {canonFacts.length === 0 ? (
              <p className="text-[13px] text-muted">該当する設定がありません。</p>
            ) : (
              canonFacts.map((fact) => <CanonFactCard key={fact.id} fact={fact} />)
            )}
          </div>
        </section>

        <section className="mt-xl">
          <h2 className="text-title-sm font-medium text-ink">生成された嘘</h2>
          <div className="mt-sm space-y-sm">
            {fabricatedFacts.length === 0 ? (
              <p className="text-[13px] text-muted">まだこのセッションでは嘘が生成されていません。</p>
            ) : (
              fabricatedFacts.map((fact) => (
                <FabricatedFactCard key={fact.id} fact={fact} related={relatedLabelsFor(fact.id, fabricatedFacts, graph)} />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

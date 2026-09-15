"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatHeader } from "./ChatHeader";
import { ChatMessageItem } from "./ChatMessageItem";
import { TypingIndicator } from "./TypingIndicator";
import { ChatInput } from "./ChatInput";
import { Mascot } from "@/components/ui/Mascot";
import {
  getFabricatedFacts,
  getSessionData,
  listSessions,
  sendMessage,
  type SessionSummary,
} from "@/lib/client/api";
import type { ChatSession, Message, Work } from "@/lib/server/types";
import { sessionLabel, type ViewMessage } from "@/lib/client/types";

function toViewMessage(message: Message, factIdsByMessage: Map<string, string[]>): ViewMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    fabricatedFactIds: factIdsByMessage.get(message.id),
    speaker: message.speaker,
  };
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-sm bg-canvas px-md text-center">
      <Mascot size={96} variant="display" animated={false} />
      <p className="max-w-[320px] text-[14px] text-muted">{children}</p>
    </div>
  );
}

/** 答え合わせ済みの会話は続けられない。入力欄の代わりに結果と次のセッションへの導線を出す */
function RevealedFooter({ sessionId }: { sessionId: string }) {
  return (
    <div className="border-t border-hairline bg-canvas px-md py-sm">
      <div className="mx-auto flex max-w-[760px] flex-col gap-sm rounded-xl bg-surface-card px-md py-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-body">この会話は答え合わせ済み。ここから先は、新しいセッションで。</p>
        <div className="flex shrink-0 gap-xs">
          <Link
            href={`/reveal/${sessionId}`}
            className="rounded-md border border-hairline bg-canvas px-sm py-xxs text-[13px] font-medium text-ink transition-colors hover:bg-surface-soft"
          >
            結果を見る
          </Link>
          <Link
            href="/"
            className="rounded-md bg-primary px-sm py-xxs text-[13px] font-medium text-on-primary transition-colors hover:bg-primary-active"
          >
            新しいセッション
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ChatApp({ sessionId }: { sessionId: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<ViewMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [data, facts] = await Promise.all([getSessionData(sessionId), getFabricatedFacts(sessionId)]);
        if (cancelled) return;

        const factIdsByMessage = new Map<string, string[]>();
        for (const fact of facts) {
          const list = factIdsByMessage.get(fact.introducedMessageId) ?? [];
          list.push(fact.id);
          factIdsByMessage.set(fact.introducedMessageId, list);
        }

        setWork(data.work);
        setSession(data.session);
        setMessages(data.messages.map((m) => toViewMessage(m, factIdsByMessage)));

        const list = await listSessions(data.work.id);
        if (!cancelled) setSessions(list);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) return;

    setInput("");
    setSendError(null);
    setIsSending(true);

    const userMessage: ViewMessage = {
      id: `local-user-${crypto.randomUUID()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    // 返答を待つ間も入力中の表示を出すため、吹き出しは先に1つ積んでおき、
    // 最初の message-start はそれに充てる。1回の送信でシオリ→（ときどき）としお、
    // と複数の発話が届きうるので、2つ目以降の message-start は新しく積む。
    const placeholderId = `local-assistant-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: placeholderId, role: "assistant", content: "", createdAt: new Date().toISOString(), isStreaming: true },
    ]);
    let placeholderUsed = false;
    // 以降の token/metadata はこの吹き出しに紐づける
    let currentId: string | null = null;

    try {
      await sendMessage(sessionId, text, {
        onMessageStart: (speaker) => {
          if (!placeholderUsed) {
            placeholderUsed = true;
            currentId = placeholderId;
            setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, speaker } : m)));
            return;
          }
          const id = `local-assistant-${crypto.randomUUID()}`;
          currentId = id;
          setMessages((prev) => [
            ...prev,
            { id, role: "assistant", content: "", createdAt: new Date().toISOString(), isStreaming: true, speaker },
          ]);
        },
        onToken: (chunk) => {
          const id = currentId;
          if (!id) return;
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)));
        },
        onMetadata: (data) => {
          const id = currentId;
          if (!id) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, fabricatedFactIds: data.fabricatedFactIds, strategy: data.strategy } : m,
            ),
          );
        },
        onMessageEnd: () => {
          const id = currentId;
          if (!id) return;
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isStreaming: false } : m)));
          currentId = null;
        },
        onDone: () => {},
        onTopic: (topic) => setSession((prev) => (prev ? { ...prev, topic } : prev)),
      });

      if (work) {
        listSessions(work.id)
          .then(setSessions)
          .catch(() => {});
      }
    } catch (e) {
      const id = currentId;
      if (id) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, isStreaming: false, content: m.content || "……ちょっと分からなくなった。もう一度言って。" }
              : m,
          ),
        );
      }
      setSendError(e instanceof Error ? e.message : "送信に失敗しました。回線を確認してもう一度試して。");
    } finally {
      // 何も届かないまま終わった（送信自体の失敗など）placeholder は消し、
      // message-end が来ないまま閉じた吹き出しは streaming を解除する
      setMessages((prev) =>
        prev
          .filter((m) => !(m.id === placeholderId && !placeholderUsed))
          .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
      );
      setIsSending(false);
    }
  }

  if (loading) return <CenteredNote>読み込み中……</CenteredNote>;
  if (loadError || !work || !session) {
    return <CenteredNote>{loadError ?? "セッションが見つかりませんでした。"}</CenteredNote>;
  }

  return (
    <div className="flex h-dvh bg-canvas">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        work={work}
        sessions={sessions}
        activeSessionId={sessionId}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          workTitle={work.title}
          sessionLabel={sessionLabel(session)}
          sessionId={sessionId}
          revealed={Boolean(session.reveal)}
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] py-sm">
            {messages.map((message) =>
              message.isStreaming && message.content === "" ? (
                <TypingIndicator key={message.id} speaker={message.speaker} />
              ) : (
                <ChatMessageItem key={message.id} message={message} sessionId={sessionId} />
              ),
            )}
          </div>
        </div>

        {sendError && (
          <div className="mx-auto w-full max-w-[760px] px-md pb-xs">
            <p className="rounded-md bg-error/10 px-sm py-xs text-[13px] text-error">{sendError}</p>
          </div>
        )}

        {session.reveal ? (
          <RevealedFooter sessionId={sessionId} />
        ) : (
          <ChatInput value={input} onChange={setInput} onSend={handleSend} disabled={isSending} />
        )}
      </div>
    </div>
  );
}

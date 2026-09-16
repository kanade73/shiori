"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatHeader } from "./ChatHeader";
import { ChatMessageItem } from "./ChatMessageItem";
import { TypingIndicator } from "./TypingIndicator";
import { ChatInput } from "./ChatInput";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { DevPanel } from "@/components/devpanel/DevPanel";
import { useDevMode } from "@/components/devpanel/useDevMode";
import { Mascot } from "@/components/ui/Mascot";
import {
  createSession,
  deleteSession,
  getSessionData,
  listSessions,
  sendMessage,
  type SessionSummary,
} from "@/lib/client/api";
import type { ChatSession, Message, Work } from "@/lib/server/types";
import { sessionLabel, type ViewMessage } from "@/lib/client/types";
import { localId } from "@/lib/client/id";

function toViewMessage(message: Message): ViewMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    speaker: message.speaker,
    expression: message.expression,
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
function RevealedFooter({
  sessionId,
  onNewSession,
  creatingSession,
}: {
  sessionId: string;
  onNewSession: () => void;
  creatingSession: boolean;
}) {
  return (
    <div className="border-t border-hairline bg-canvas px-md py-sm">
      <div className="pixel-frame pixel-dither mx-auto flex max-w-[860px] flex-col gap-sm bg-surface-card px-md py-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-body">この会話は答え合わせ済み。ここから先は、新しいセッションで。</p>
        <div className="flex shrink-0 gap-xs">
          <Link
            href={`/reveal/${sessionId}`}
            className="pixel-btn border-2 border-hairline bg-canvas px-sm py-xxs font-pixel text-[16px] text-ink hover:bg-surface-soft"
          >
            結果を見る
          </Link>
          <button
            type="button"
            onClick={onNewSession}
            disabled={creatingSession}
            className="pixel-btn bg-primary px-sm py-xxs font-pixel text-[16px] text-on-primary enabled:hover:bg-primary-active disabled:bg-primary-disabled"
          >
            新しいセッション
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatApp({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [devMode, toggleDevMode] = useDevMode();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<ViewMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // サイドバーのゴミ箱で消そうとしているセッション（確認のダイアログを出している間だけ）
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 「新しいセッション」を押してから、新しいセッションの画面に移るまで
  const [creatingSession, setCreatingSession] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      // 同じ画面のまま別のセッションに移るので、「新しいセッション」を作っている途中の状態はここで戻す
      setCreatingSession(false);
      try {
        const data = await getSessionData(sessionId);
        if (cancelled) return;

        setWork(data.work);
        setSession(data.session);
        setMessages(data.messages.map(toViewMessage));

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
      id: `local-user-${localId()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    // 返答を待つ間も入力中の表示を出すため、吹き出しは先に1つ積んでおき、
    // 最初の message-start はそれに充てる。1回の送信でシオリ→（ときどき）としお、
    // と複数の発話が届きうるので、2つ目以降の message-start は新しく積む。
    const placeholderId = `local-assistant-${localId()}`;
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
        onMessageStart: (speaker, expression) => {
          if (!placeholderUsed) {
            placeholderUsed = true;
            currentId = placeholderId;
            setMessages((prev) => prev.map((m) => (m.id === placeholderId ? { ...m, speaker, expression } : m)));
            return;
          }
          const id = `local-assistant-${localId()}`;
          currentId = id;
          setMessages((prev) => [
            ...prev,
            { id, role: "assistant", content: "", createdAt: new Date().toISOString(), isStreaming: true, speaker, expression },
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
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, strategy: data.strategy } : m)));
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
              ? { ...m, isStreaming: false, content: m.content || "ちょっと分からなくなった。もう一度言って。" }
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

  /** スタート画面の「シオリと話す」と同じく、今の作品で新しいセッションを作ってそのチャットに移る */
  async function startNewSession() {
    if (!work || creatingSession) return;
    setCreatingSession(true);
    setSendError(null);
    try {
      const { sessionId: newSessionId } = await createSession(work.id);
      router.push(`/chat/${newSessionId}`);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "セッションの作成に失敗しました");
      setCreatingSession(false);
    }
  }

  function requestDeleteSession(id: string) {
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    setDeleteError(null);
    setDeleteTarget(target);
  }

  async function confirmDeleteSession() {
    if (!deleteTarget) return false;
    const id = deleteTarget.id;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSession(id);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "削除に失敗しました");
      setDeleting(false);
      return false;
    }
    setDeleting(false);
    setDeleteTarget(null);
    // 開いている会話を消したら、ここには居られないので最初の画面へ
    if (id === sessionId) {
      router.push("/");
      return true;
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    return true;
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
        onDeleteSession={requestDeleteSession}
        onNewSession={startNewSession}
        creatingSession={creatingSession}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          workTitle={work.title}
          sessionLabel={sessionLabel(session)}
          sessionId={sessionId}
          revealed={Boolean(session.reveal)}
          onOpenSidebar={() => setSidebarOpen(true)}
          devMode={devMode}
          onToggleDevMode={toggleDevMode}
        />

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[860px] py-sm">
            {messages.map((message) =>
              message.isStreaming && message.content === "" ? (
                <TypingIndicator key={message.id} speaker={message.speaker} expression={message.expression} />
              ) : (
                <ChatMessageItem key={message.id} message={message} />
              ),
            )}
          </div>
        </div>

        {sendError && (
          <div className="mx-auto w-full max-w-[860px] px-md pb-xs">
            <p className="rounded-md bg-[#c6435a1a] px-sm py-xs text-[13px] text-error">{sendError}</p>
          </div>
        )}

        {session.reveal ? (
          <RevealedFooter sessionId={sessionId} onNewSession={startNewSession} creatingSession={creatingSession} />
        ) : (
          <ChatInput value={input} onChange={setInput} onSend={handleSend} disabled={isSending} />
        )}
      </div>

      {devMode && <DevPanel sessionId={sessionId} onClose={toggleDevMode} />}

      {deleteTarget && (
        <DeleteSessionDialog
          sessionLabel={sessionLabel(deleteTarget)}
          deleting={deleting}
          error={deleteError}
          onConfirm={confirmDeleteSession}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

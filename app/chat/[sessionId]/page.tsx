import { ChatApp } from "@/components/ChatApp";

export default async function ChatPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <ChatApp sessionId={sessionId} />;
}

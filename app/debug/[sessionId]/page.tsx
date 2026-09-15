import { DebugView } from "@/components/debug/DebugView";

export default async function DebugPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <DebugView sessionId={sessionId} />;
}

import { RevealView } from "@/components/RevealView";

export default async function RevealPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <RevealView sessionId={sessionId} />;
}

import { RevealView } from "@/components/reveal/RevealView";

export default async function RevealPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <RevealView sessionId={sessionId} />;
}

import { LearnClient } from "@/components/learn/learn-client";

export default async function LearnPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return <LearnClient itemId={itemId} />;
}

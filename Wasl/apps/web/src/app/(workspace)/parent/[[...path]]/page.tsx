import { LearningPage } from "@/components/workspace/learning/page";
export default async function Page({ params }: { params: Promise<{ path?: string[] }> }) { const { path } = await params; return <LearningPage role="parent" path={path} />; }

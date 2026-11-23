import { ApiWorkspace } from "@/components/connected/workspace";
export default async function Page({ params }: { params: Promise<{ path?: string[] }> }) { const { path } = await params; return <ApiWorkspace role="student" path={path} />; }

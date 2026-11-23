import { ApiWorkspace } from "@/components/connected/workspace";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <ApiWorkspace role="admin" path={["schools", id]} />; }

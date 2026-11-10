import type { ReactNode } from "react";
import { WorkspaceProvider } from "@/components/workspace/provider";
export default function Layout({ children }: { children: ReactNode }) { return <WorkspaceProvider>{children}</WorkspaceProvider>; }

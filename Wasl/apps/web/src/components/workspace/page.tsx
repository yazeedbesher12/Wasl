"use client";
import Link from "next/link";
import { useEffect } from "react";
import { academicKinds, allowed, canCreate, canEdit, context, pageAllowed, pageKind } from "@wasl/shared/demo";
import { useWorkspace } from "./provider";
import { WorkspaceShell } from "./shell";
import { Dashboard } from "./dashboard";
import { Gradebook } from "./gradebook";
import { RecordList } from "./records";
import { RecordDetail } from "./detail";
import { RecordEditor } from "./editor";
import { SchoolSettings } from "./settings";
import { SnapshotTransfer } from "./transfer";

export function WorkspacePage({ role, path = [] }: { role: "school" | "teacher"; path?: string[] }) {
  const w = useWorkspace(); const { data, session, t } = w;
  const page = path[0] ?? "dashboard"; const id = path[1]; const mode = path[2]; const kind = pageKind(page);
  useEffect(() => { w.setError(undefined); }, [page, id, mode, role, w.setError]);
  let content;
  try {
    if (!data) content = <p role="status">{t("loading")}</p>;
    else {
      const c = context(data, session);
      if (c.admin !== (role === "school") || !pageAllowed(data, session, page) || path.length > 3 || (mode && mode !== "edit")) throw new Error();
      const row = kind && id && id !== "new" ? allowed(data, session, kind, id) : undefined;
      if (page === "dashboard") content = <Dashboard role={role} />;
      else if (page === "gradebook" && !id) content = <Gradebook />;
      else if (page === "transfer") content = <SnapshotTransfer />;
      else if (page === "settings" && c.admin) content = <SchoolSettings />;
      else if (kind) {
        if (id === "new" || mode === "edit") {
          if (!canCreate(data, session, kind) || row && !canEdit(data, session, kind, row)) throw new Error();
          content = <RecordEditor key={`${session.membershipId}:${kind}:${id}`} kind={kind} row={row} role={role} />;
        } else if (row) content = <RecordDetail key={`${session.membershipId}:${kind}:${id}`} kind={kind} row={row} role={role} />;
        else content = <RecordList key={`${session.membershipId}:${page}`} kind={kind} role={role} />;
      } else throw new Error();
    }
  } catch (e) { content = <div className="empty"><p role="alert">{t(e instanceof Error && e.message === "suspended" ? "suspended" : "unavailable")}</p><Link href="/demo" className="button">{t("switchAccount")}</Link></div>; }
  return <WorkspaceShell role={role} page={page}><header className={page === "dashboard" && !id ? "sr-only" : "page-heading"}><div><h1>{t(page)}</h1><p className="muted">{t(role === "teacher" ? "teacherHelp" : "intro")}</p></div><div className="actions">{id && <Link className="button secondary" href={`/${role}/${page}`}>{t("back")}</Link>}{data && kind && !id && (() => { try { return canCreate(data, session, kind) && <Link className="button" href={`/${role}/${kind}/new`}>+ {t("create")}</Link>; } catch { return null; } })()}</div></header>{["academics", ...academicKinds].includes(page) && role === "school" && <nav className="academic-tabs" aria-label={t("academics")}>{academicKinds.map(k => <Link key={k} className={kind === k ? "selected" : ""} href={`/school/${k}`}>{t(k)}</Link>)}</nav>}{content}</WorkspaceShell>;
}

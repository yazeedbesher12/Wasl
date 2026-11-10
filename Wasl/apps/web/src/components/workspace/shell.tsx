"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { navigationGroup, context, label, learningContext, learningIdentity, learningNav, learningNotifications, learningPath, number, schoolNav, teacherNav, visible } from "@wasl/shared/demo";
import type { NamedView } from "@wasl/shared/demo";
import { useWorkspace } from "./provider";
import { Feedback, Language, Modal } from "./ui";
import { EducationBackground, NavigationIcon } from "../education";

export function WorkspaceShell({ role, page, childLinkId, children }: { role?: "school" | "teacher" | "student" | "parent"; page?: string; childLinkId?: string; children: ReactNode }) {
  const w = useWorkspace(); const { data, session, t, locale, dirty, navigate } = w;
  const [menu, setMenu] = useState(false);
  const learner = role === "student" || role === "parent";
  const learningRole = role === "student" ? "student" : "parent";
  const scopedSession = { ...session, childLinkId };
  let identity: { user: NamedView; school?: NamedView } | undefined; let unread = 0;
  try { if (data) {
    identity = learner ? learningIdentity(data, scopedSession) : context(data, session);
    if (learner) { try { identity = learningContext(data, scopedSession); } catch { /* A parent may be on the family overview without a selected child. */ } }
    unread = learner ? learningNotifications(data, scopedSession).filter(n => !n.read).length : visible(data, session, "notifications").filter(n => !n.values.readAt).length;
  } } catch { /* The entry/recovery view explains unavailable memberships. */ }
  const nav = learner ? learningNav(learningRole) : role === "teacher" ? teacherNav : schoolNav;
  const href = (p: string) => learner ? learningPath(learningRole, childLinkId, p) : `/${role}/${p}`;
  useEffect(() => { setMenu(false); }, [page, role]);
  const navigation = <nav aria-label={t("more")}>{["navWorkspace", "navManage", "navLearning", "navAccount"].map(g => {
    const pages = nav.filter(p => navigationGroup(p) === g);
    return pages.length ? <div className="navigation-group" key={g}><p className="nav-label">{t(g)}</p>{pages.map(p => {
      const active = p === page || p === "academics" && ["years", "semesters", "grades", "sections", "subjects", "assignments", "enrollments", "preferences"].includes(page ?? "");
      return <Link key={p} className={`nav-link ${active ? "selected" : ""}`} href={href(p)} aria-current={active ? "page" : undefined} onClick={() => setMenu(false)}><NavigationIcon page={p} />{t(learner && p === "results" ? "releasedResults" : role === "parent" && p === "classes" ? "childClasses" : p)}</Link>;
    })}</div> : null;
  })}</nav>;
  return <div className="admin-shell connected-workspace" onClickCapture={e => {
    const anchor = e.target instanceof Element ? e.target.closest("a") : null;
    if (dirty && anchor && anchor.getAttribute("href")?.startsWith("/") && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); navigate(anchor.getAttribute("href")!); }
  }}>
    <a className="skip-link" href="#workspace-main">{t("skipWorkspace")}</a>{role && <aside className="sidebar"><Link className="brand" href="/demo"><span className="brand-symbol">و</span><span>{t("wasl")}<small>{t(role === "school" ? "schoolAdmin" : role)}</small></span></Link><div className="sidebar-workspace"><span className="workspace-status-dot" />{identity?.school ? label(locale, identity.school) : t("wasl")}</div>{navigation}<div className="sidebar-note">{identity && <Link href="/demo" className="sidebar-identity"><span className="identity-avatar">{label(locale, identity.user).slice(0, 1)}</span><span>{label(locale, identity.user)}<small>{t("switchAccount")}</small></span></Link>}<span className="badge neutral">{t("demo")}</span><p>{t("localNotice")}</p></div></aside>}
    <div className="workspace"><EducationBackground /><header className="topbar"><div className="topbar-start">{role && <button className="icon-button menu-toggle" aria-label={t("more")} aria-expanded={menu} aria-controls="workspace-navigation-drawer" onClick={() => setMenu(true)}>☰</button>}<div><strong>{identity?.school ? label(locale, identity.school) : t("wasl")}</strong><small className="muted">{identity ? label(locale, identity.user) : t("switchAccount")}</small></div><span className="badge neutral">{t("demo")}</span></div><div className="topbar-end"><Language />{role && identity && <Link className="notification-link" href={href("notifications")}>{t("notifications")} <span className="badge neutral">{number(locale, unread)}</span></Link>}<Link href="/demo" className="text-link">{t("switchAccount")}</Link></div></header>
      <main id="workspace-main" tabIndex={-1}><Feedback />{children}</main><footer className="workspace-footer">{t("localNotice")}</footer>
    </div>
    {menu && <Modal title={t("more")} className="mobile-drawer" close={() => setMenu(false)}><div id="workspace-navigation-drawer">{navigation}</div></Modal>}
    {w.pendingHref && <Modal title={t("discard")} close={() => w.setPendingHref("")}><p>{t("discardHelp")}</p><div className="dialog-actions"><button className="button secondary" onClick={() => w.setPendingHref("")}>{t("cancel")}</button><button className="button danger" onClick={() => { const href = w.pendingHref; w.discardDraft(); w.setPendingHref(""); navigate(href, true); }}>{t("confirm")}</button></div></Modal>}
  </div>;
}

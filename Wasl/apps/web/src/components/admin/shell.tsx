"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AdminProvider, useAdmin } from "./provider";
import { Dialog, LanguageSwitch } from "./ui";
import { EducationBackground } from "../education";
import type { Message } from "@/lib/admin/i18n";

const navigation: { href: string; label: Message; icon: string }[] = [
  { href: "/admin", label: "overview", icon: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" },
  { href: "/admin/schools", label: "schools", icon: "M3 21h18 M5 21V9l7-6 7 6v12 M9 21v-7h6v7 M10 9h4" },
  { href: "/admin/activity", label: "activity", icon: "M3 12h4l3-8 4 16 3-8h4" },
  { href: "/admin/settings", label: "settings", icon: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6" },
];
function Shell({ children }: { children: ReactNode }) {
  const { t, data, locale, loadError, load, persistent, recovered, notice, dismiss } = useAdmin();
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMenu(false); }, [pathname]);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 901px)");
    const close = () => { if (query.matches) setMenu(false); };
    query.addEventListener("change", close);
    return () => query.removeEventListener("change", close);
  }, []);
  const links = <nav aria-label={t("navigation")}>{navigation.map(n => {
    const active = n.href === "/admin" ? pathname === n.href : pathname.startsWith(n.href);
    return <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={active ? "nav-link selected" : "nav-link"} onClick={() => setMenu(false)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={n.icon} /></svg>{t(n.label)}</Link>;
  })}</nav>;
  return <div className="admin-shell"><a href="#main-content" className="skip-link">{t("skip")}</a><aside className="sidebar"><Link href="/admin" className="brand"><span className="brand-symbol" aria-hidden="true">و</span><span>{t("brand")}<small>{t("platform")}</small></span></Link><div className="nav-label">{t("role")}</div>{links}<div className="sidebar-note"><Link href="/demo" className="sidebar-identity"><span className="identity-avatar">{(locale === "ar" ? data?.administrator.nameAr : data?.administrator.name)?.slice(0, 1) ?? "و"}</span><span>{data ? locale === "ar" ? data.administrator.nameAr : data.administrator.name : t("role")}<small>{t("role")}</small></span></Link><span className="badge neutral">{t("demo")}</span><p>{t("demoNotice")}</p></div></aside>
    <div className="workspace"><EducationBackground /><header className="topbar"><div className="topbar-start"><button type="button" className="icon-button menu-toggle" aria-label={t("openMenu")} aria-expanded={menu} aria-controls="mobile-navigation" onClick={() => setMenu(true)}>☰</button><span className="topbar-title">{t("platform")}</span><span className="badge neutral">{t("demo")}</span></div><div className="topbar-end"><LanguageSwitch /><div className="identity"><span className="identity-avatar" aria-hidden="true">{(locale === "ar" ? data?.administrator.nameAr : data?.administrator.name)?.slice(0, 1) ?? "و"}</span><span>{data ? locale === "ar" ? data.administrator.nameAr : data.administrator.name : t("role")}<small>{t("role")}</small></span></div></div></header>
      <main id="main-content" tabIndex={-1}>
        {!persistent && <p className="banner warning" role="status">{t("storageWarning")}</p>}
        {recovered && <p className="banner" role="status">{t("recovered")}</p>}
        {loadError ? <div className="empty" role="alert"><p>{t("loadError")}</p><button className="button" onClick={() => void load()}>{t("retry")}</button></div> : !data ? <p className="loading" role="status">{t("loading")}</p> : children}
      </main><footer className="workspace-footer"><Link className="text-link" href="/demo">{locale === "ar" ? "مساحات المدرسة والمعلم" : "School & teacher workspaces"}</Link><p>{t("demoNotice")}</p></footer>
    </div>
    {notice && <div className={`toast ${notice.error ? "toast-error" : ""}`} role={notice.error ? "alert" : "status"}><span>{t(notice.key)}</span><button className="icon-button" aria-label={t("close")} onClick={dismiss}>×</button></div>}
    {menu && <Dialog title={t("navigation")} className="mobile-drawer" onClose={() => setMenu(false)}><div id="mobile-navigation">{links}</div><p className="muted">{t("demoNotice")}</p></Dialog>}
  </div>;
}
export function AdminShell({ children }: { children: ReactNode }) { return <AdminProvider><Shell>{children}</Shell></AdminProvider>; }

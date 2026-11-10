"use client";
import Link from "next/link";
import { useState } from "react";
import { context, get, label, learningIdentity, roleWorkspace, workspaceRoles } from "@wasl/shared/demo";
import { useWorkspace } from "./provider";
import { WorkspaceShell } from "./shell";
import { SnapshotTransfer } from "./transfer";
import { EducationArt } from "../education";

export function DemoEntry() {
  const w = useWorkspace(); const { data, locale, t, session, selectMembership, navigate, load, busy } = w;
  const [schoolId, setSchool] = useState(""); const [membershipId, setMembership] = useState("");
  const [role, setRole] = useState(""); const [query, setQuery] = useState("");
  const selectedSchool = schoolId || data?.records.memberships.find(m => m.id === session.membershipId)?.schoolId || data?.schools.find(s => s.active)?.id || "";
  const members = data?.records.memberships.filter(m => {
    const person = get(data!, "users", m.values.userId);
    return m.schoolId === selectedSchool && m.active && person?.active && workspaceRoles.some(r => r === m.values.role) && (!role || m.values.role === role) && (!query || `${person.name} ${person.nameAr} ${person.values.email}`.toLowerCase().includes(query.toLowerCase()));
  }) ?? [];
  const selectedMember = members.find(m => m.id === membershipId) ?? members.find(m => m.id === session.membershipId) ?? members[0];
  const options = members.slice(0, 100); if (selectedMember && !options.includes(selectedMember)) options.unshift(selectedMember);
  return <WorkspaceShell><div className="demo-entry"><div className="entry-composition"><aside className="entry-introduction"><span className="entry-wordmark">{t("wasl")}<span className="wordmark-dot" /></span><h1>{t("welcomeEntry")}</h1><p>{t("learningIntro")}</p><EducationArt theme="entry" /><span className="entry-demo-note">{t("localNotice")}</span></aside><div className="entry-selection"><header className="page-heading"><div><h1>{t("switchAccount")}</h1><p className="muted">{t("localNotice")}</p></div></header>
    {!data ? <><p>{t("loading")}</p><button className="button secondary" onClick={() => void load()}>{t("retry")}</button></> : <section className="panel entry-panel">
      <label>{t("chooseSchool")}<select value={selectedSchool} disabled={busy} onChange={e => { setSchool(e.target.value); setMembership(""); }}>{data.schools.map(s => <option value={s.id} key={s.id}>{label(locale, s)}{s.active ? "" : ` · ${t("suspended")}`}</option>)}</select></label>
      <div className="form-grid workspace-fields"><label>{t("role")}<select value={role} disabled={busy} onChange={e => { setRole(e.target.value); setMembership(""); }}><option value="">{t("all")}</option>{workspaceRoles.map(r => <option key={r} value={r}>{t(r)}</option>)}</select></label><label>{t("search")}<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
      <label>{t("chooseAccount")}<select value={selectedMember?.id ?? ""} disabled={busy} onChange={e => setMembership(e.target.value)}>{options.map(m => <option key={m.id} value={m.id}>{label(locale, get(data, "users", m.values.userId))} · {t(m.values.role)} · {get(data, "users", m.values.userId)?.values.email}</option>)}</select></label>
      {!members.length && <p>{t("noAccounts")}</p>}
      <button className="button" disabled={busy || !selectedMember || !data.schools.find(s => s.id === selectedSchool)?.active} onClick={() => {
        if (!selectedMember) return;
        try {
          if (["STUDENT", "PARENT"].includes(selectedMember.values.role)) learningIdentity(data, { membershipId: selectedMember.id }); else context(data, { membershipId: selectedMember.id });
          selectMembership(selectedMember.id); navigate(`/${roleWorkspace(selectedMember.values.role)}/${selectedMember.values.role === "PARENT" ? "children" : "dashboard"}`, true);
        } catch { w.setError({ code: "unavailable" }); }
      }}>{t("enter")}</button><Link className="text-link" href="/admin">{t("platformAdmin")}</Link>
    </section>}
    </div></div><SnapshotTransfer />
  </div></WorkspaceShell>;
}

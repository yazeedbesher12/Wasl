"use client";

import { useState } from "react";
import { useAdmin } from "@/components/admin/provider";
import { actionLabel, ActivityList, Empty, Heading } from "@/components/admin/ui";
import type { Action } from "@/lib/admin/model";

export default function ActivityPage() {
  const { data, t, schoolName, number } = useAdmin();
  const [school, setSchool] = useState("all");
  const [action, setAction] = useState("all");
  const [page, setPage] = useState(1);
  if (!data) return null;
  const reset = () => { setSchool("all"); setAction("all"); setPage(1); };
  const entries = data.activity.filter(a => (school === "all" || a.schoolId === school) && (action === "all" || a.action === action));
  const pages = Math.max(1, Math.ceil(entries.length / 12));
  const current = Math.min(page, pages);
  return <><Heading title={t("activity")} intro={t("activityIntro")} /><section className="panel activity-panel"><div className="toolbar"><label>{t("school")}<select value={school} onChange={e => { setSchool(e.target.value); setPage(1); }}><option value="all">{t("allSchools")}</option>{data.schools.map(s => <option key={s.id} value={s.id}>{schoolName(s)}</option>)}</select></label><label>{t("action")}<select value={action} onChange={e => { setAction(e.target.value); setPage(1); }}><option value="all">{t("allActions")}</option>{(Object.keys(actionLabel) as Action[]).map(a => <option key={a} value={a}>{t(actionLabel[a])}</option>)}</select></label><button className="button secondary" disabled={school === "all" && action === "all"} onClick={reset}>{t("resetFilters")}</button></div>
    <div className="result-summary" role="status">{number(entries.length)} {t("results")}</div>
    {entries.length ? <ActivityList entries={entries.slice((current - 1) * 12, current * 12)} /> : <Empty title={t(data.activity.length ? "noActivityMatches" : "noActivity")} body={t("noActivityBody")} />}
    <div className="pagination"><span>{t("page")} {number(current)} {t("of")} {number(pages)}</span><div className="actions"><button className="button secondary" disabled={current === 1} onClick={() => setPage(current - 1)}>{t("previous")}</button><button className="button secondary" disabled={current === pages} onClick={() => setPage(current + 1)}>{t("next")}</button></div></div>
  </section></>;
}

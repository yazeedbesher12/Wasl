"use client";

import Link from "next/link";
import { Welcome, NavigationIcon } from "@/components/education";
import { useAdmin } from "@/components/admin/provider";
import { ActivityList, Empty, SchoolsTable } from "@/components/admin/ui";

export default function OverviewPage() {
  const { data, t, number, locale } = useAdmin();
  if (!data) return null;
  const { schools, activity } = data;
  const active = schools.filter(s => s.active).length;
  const metrics = [
    ["totalSchools", schools.length], ["activeSchools", active], ["suspendedSchools", schools.length - active],
    ["students", schools.reduce((n, s) => n + s.demo.students, 0)], ["teachers", schools.reduce((n, s) => n + s.demo.teachers, 0)],
  ] as const;
  return <><Welcome title={t("welcome")} name={locale === "ar" ? data.administrator.nameAr : data.administrator.name} intro={t("overviewIntro")} theme="platform"><Link className="button" href="/admin/schools/new"><span aria-hidden="true">+</span>{t("add")}</Link><Link className="button secondary" href="/admin/schools">{t("viewAll")}</Link></Welcome>
    <dl className="metrics">{metrics.map(([label, value]) => <div key={label}><dt><span className="metric-icon"><NavigationIcon page={label === "students" || label === "teachers" ? "memberships" : "academics"} /></span>{t(label)}</dt><dd>{number(value)}</dd></div>)}</dl>
    <section className="panel"><div className="section-heading"><h2>{t("recentSchools")}</h2><Link className="text-link" href="/admin/schools">{t("viewAll")}</Link></div>{schools.length ? <SchoolsTable compact schools={[...schools].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)} /> : <Empty title={t("noSchools")} body={t("noSchoolsBody")}><Link className="button" href="/admin/schools/new">{t("add")}</Link></Empty>}</section>
    <section className="panel activity-panel"><div className="section-heading"><h2>{t("recentActivity")}</h2><Link className="text-link" href="/admin/activity">{t("viewActivity")}</Link></div><ActivityList entries={activity.slice(0, 5)} /></section>
    <p className="footnote">{t("scope")}</p>
  </>;
}

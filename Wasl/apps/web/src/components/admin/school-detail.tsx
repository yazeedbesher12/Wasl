"use client";

import Link from "next/link";
import { useAdmin } from "./provider";
import { ActivityList, Empty, Heading, SchoolActions, Status } from "./ui";

export function MissingSchool() {
  const { t } = useAdmin();
  return <Empty title={t("unknown")} body={t("unknownBody")}><Link className="button secondary" href="/admin/schools">{t("back")}</Link></Empty>;
}
export function SchoolDetail({ id }: { id: string }) {
  const { data, t, locale, schoolName, number, date } = useAdmin();
  if (!data) return null;
  const school = data.schools.find(s => s.id === id);
  if (!school) return <MissingSchool />;
  return <><Link className="breadcrumb" href="/admin/schools">{t("back")}</Link><Heading title={schoolName(school)} intro={locale === "ar" ? school.name : school.nameAr}><SchoolActions school={school} detail /></Heading>
    <dl className="metrics detail-metrics"><div><dt>{t("status")}</dt><dd><Status active={school.active} /></dd></div><div><dt>{t("students")}</dt><dd>{number(school.demo.students)}</dd></div><div><dt>{t("teachers")}</dt><dd>{number(school.demo.teachers)}</dd></div></dl>
    <div className="detail-grid"><section className="panel profile-panel"><h2>{t("profile")}</h2><dl className="definition-list"><div><dt>{t("name")}</dt><dd dir="ltr">{school.name}</dd></div><div><dt>{t("nameAr")}</dt><dd dir="rtl">{school.nameAr}</dd></div><div><dt>{t("location")}</dt><dd>{locale === "ar" ? school.demo.cityAr : school.demo.city}</dd></div><div><dt>{t("schoolLocale")}</dt><dd>{school.locale === "ar" ? "العربية" : "English"}</dd></div><div><dt>{t("createdAt")}</dt><dd>{date(school.createdAt)}</dd></div><div><dt>{t("identifier")}</dt><dd className="identifier" dir="ltr">{school.id}</dd></div></dl></section>
    <section className="panel profile-panel"><h2>{t("adminContact")}</h2><p className="contact-name">{locale === "ar" ? school.demo.administratorAr : school.demo.administrator}</p><a className="text-link email" dir="ltr" href={`mailto:${school.demo.email}`}>{school.demo.email}</a><hr /><h3>{t("schoolAccess")}</h3><p className="muted">{t("accessHelp")}</p><Status active={school.active} /></section></div>
    <section className="panel activity-panel"><div className="section-heading"><h2>{t("activity")}</h2></div><ActivityList entries={data.activity.filter(a => a.schoolId === id)} /></section><p className="footnote">{t("scope")}</p>
  </>;
}

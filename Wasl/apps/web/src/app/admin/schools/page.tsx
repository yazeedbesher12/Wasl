"use client";

import Link from "next/link";
import { useState } from "react";
import { useAdmin } from "@/components/admin/provider";
import { Empty, Heading, SchoolsTable } from "@/components/admin/ui";

const PAGE_SIZE = 6;
export default function SchoolsPage() {
  const { data, t, locale, schoolName, number } = useAdmin();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  if (!data) return null;
  const reset = () => { setQuery(""); setStatus("all"); setSort("newest"); setPage(1); };
  const normalized = query.trim().normalize("NFKC").toLocaleLowerCase(locale);
  const filtered = data.schools.filter(s => (!normalized || [s.name, s.nameAr, s.demo.city, s.demo.cityAr].some(v => v.normalize("NFKC").toLocaleLowerCase(locale).includes(normalized))) && (status === "all" || s.active === (status === "active")))
    .sort((a, b) => sort === "name" ? schoolName(a).localeCompare(schoolName(b), locale) : sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const start = (current - 1) * PAGE_SIZE;
  return <><Heading title={t("schools")} intro={t("schoolsIntro")}><Link className="button" href="/admin/schools/new"><span aria-hidden="true">+</span>{t("add")}</Link></Heading>
    {data.schools.length === 0 ? <section className="panel"><Empty title={t("noSchools")} body={t("noSchoolsBody")}><Link className="button" href="/admin/schools/new">{t("add")}</Link></Empty></section> : <section className="panel">
      <div className="toolbar"><label className="search-field">{t("search")}<input type="search" value={query} placeholder={t("searchHint")} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label><label>{t("status")}<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">{t("allStatuses")}</option><option value="active">{t("active")}</option><option value="suspended">{t("suspended")}</option></select></label><label>{t("sort")}<select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="newest">{t("newest")}</option><option value="oldest">{t("oldest")}</option><option value="name">{t("alphabetical")}</option></select></label><button className="button secondary" onClick={reset} disabled={!query && status === "all" && sort === "newest"}>{t("resetFilters")}</button></div>
      <div className="result-summary" role="status">{number(filtered.length)} {t("results")} · {number(data.schools.length)} {t("totalSchools")}</div>
      {filtered.length ? <SchoolsTable schools={filtered.slice(start, start + PAGE_SIZE)} /> : <Empty title={t("noMatches")} body={t("noMatchesBody")}><button className="button secondary" onClick={reset}>{t("resetFilters")}</button></Empty>}
      <div className="pagination"><span>{filtered.length ? `${number(start + 1)}–${number(Math.min(start + PAGE_SIZE, filtered.length))}` : number(0)} {t("of")} {number(filtered.length)}</span><div className="actions"><button className="button secondary" disabled={current <= 1} onClick={() => setPage(current - 1)}>{t("previous")}</button><span>{t("page")} {number(current)} {t("of")} {number(pages)}</span><button className="button secondary" disabled={current >= pages} onClick={() => setPage(current + 1)}>{t("next")}</button></div></div>
    </section>}
  </>;
}

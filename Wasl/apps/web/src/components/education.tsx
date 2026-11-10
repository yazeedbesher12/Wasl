"use client";
import { useEffect } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { navigationPath, subjectShapes, subjectTheme, welcomeShapes } from "@wasl/shared/demo";
import type { VectorShape, WelcomeTheme } from "@wasl/shared/demo";

function Shape({ s }: { s: VectorShape }) {
  const transform = s.rotate ? `rotate(${s.rotate} ${s.x + s.w / 2} ${s.y + s.h / 2})` : undefined;
  const common = { fill: s.fill ?? "none", stroke: s.stroke, strokeWidth: s.weight ?? 2.5, transform };
  if (s.type === "line") return <line x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y + s.h} stroke={s.stroke} strokeWidth={s.weight} strokeLinecap="round" />;
  if (s.type === "ellipse") return <ellipse cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} {...common} />;
  if (s.type === "text") return <text x={s.x} y={s.y + s.h * .85} fontFamily="Arial, sans-serif" fontWeight="700" fontSize={s.h} fill={s.fill}>{s.text}</text>;
  return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.radius} {...common} />;
}
export function EducationArt({ theme = "student", subject, className = "" }: { theme?: WelcomeTheme; subject?: string; className?: string }) {
  const shapes = subject !== undefined ? subjectShapes(subjectTheme(subject)) : welcomeShapes(theme);
  return <svg className={`education-art ${className}`} viewBox={subject !== undefined ? "0 0 160 160" : "0 0 400 240"} fill="none" aria-hidden="true" focusable="false">{shapes.map((s, i) => <Shape key={i} s={s} />)}</svg>;
}
/** Mount once with the shell; updates and keystrokes never replay motion. */
export function EducationBackground() {
  useEffect(() => {
    const sync = () => { document.documentElement.dataset.motionPaused = String(document.hidden); };
    sync(); document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return <div className="education-background" aria-hidden="true"><svg viewBox="0 0 1300 1100" preserveAspectRatio="xMidYMin slice" fill="none"><g stroke="#4774C9" strokeWidth="2"><path className="ambient-drift" d="M-80 180C170-10 270 265 95 328S-100 530 130 614" /><path d="M1120-40c-180 230 240 180 95 400s-30 230 140 260" strokeDasharray="4 11" /><path d="M910 920c180-180 270 110 410-40M-30 930c190-100 245 50 380-60" /><circle cx="1190" cy="600" r="57" /><path className="ambient-drift alternate" d="m1040 730 34-15 34 15v46l-34-15-34 15zm34-15v46M55 770l65-100 13 9-65 100-19 13z" /><path d="M1030 95h22m-11-11v22M225 1040h18m-9-9v18" /></g></svg></div>;
}
export function Welcome({ name, title, intro, theme, children }: { name?: string; title: string; intro: string; theme: WelcomeTheme; children?: ReactNode }) {
  return <section className={`education-welcome welcome-${theme}`}><div className="welcome-copy"><span className="welcome-eyebrow">{title}</span><h1>{name || title}</h1><p>{intro}</p>{children && <div className="actions">{children}</div>}</div><EducationArt theme={theme} className="welcome-art" /></section>;
}
export function NavigationIcon({ page }: { page: string }) { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={navigationPath(page)} /></svg>; }
export type SubjectDestination = { id: string; name: string; subject: string; detail?: string; href: string };
export function SubjectStrip({ rows, title, intro }: { rows: SubjectDestination[]; title: string; intro: string }) {
  if (!rows.length) return null;
  return <section className="subject-section"><div className="subject-heading"><div><h2>{title}</h2><p className="muted">{intro}</p></div><span className="section-orbit" aria-hidden="true">✦</span></div><div className="subject-strip">{rows.map(row => <Link className="subject-destination" href={row.href} key={row.id}><EducationArt subject={row.subject} /><strong>{row.name}</strong>{row.detail && <small>{row.detail}</small>}</Link>)}</div></section>;
}

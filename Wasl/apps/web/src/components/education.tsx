"use client";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { greetingKey, initials, navigationPath, paletteFor, quickActionPalette, subjectShapes, subjectTheme, welcomeShapes } from "@wasl/shared/demo";
import { Reveal, Stagger, StaggerItem } from "./motion";
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
  return <div className="education-background aurora" aria-hidden="true"><span className="aurora-blob a" /><span className="aurora-blob b" /><span className="aurora-blob c" /><span className="aurora-blob d" /></div>;
}
const greetings = {
  morning: { ar: "صباح الخير", en: "Good morning", icon: "☀️" },
  afternoon: { ar: "نهارك سعيد", en: "Good afternoon", icon: "🌤️" },
  evening: { ar: "مساء الخير", en: "Good evening", icon: "🌙" },
} as const;
/** Role-gradient welcome banner. Chips must carry real data only. */
export function RoleHero({ theme, ar, name, intro, chips, children }: { theme: WelcomeTheme; ar: boolean; name: string; intro: string; chips?: ReactNode; children?: ReactNode }) {
  const [greet, setGreet] = useState<keyof typeof greetings>("morning");
  const [today, setToday] = useState("");
  useEffect(() => {
    setGreet(greetingKey());
    setToday(new Date().toLocaleDateString(ar ? "ar" : "en", { weekday: "long", day: "numeric", month: "long" }));
  }, [ar]);
  const g = greetings[greet];
  return (
    <Reveal className="role-hero">
      <div className="role-hero-copy">
        <span className="role-hero-eyebrow">{ar ? g.ar : g.en} <span aria-hidden="true">{g.icon}</span></span>
        <h2>{ar ? "أهلًا، " : "Welcome, "}{name}</h2>
        <p>{intro}</p>
        <div className="role-hero-chips">{chips}{today && <span className="hero-chip">{today}</span>}</div>
        {children && <div className="actions">{children}</div>}
      </div>
      <EducationArt theme={theme} className="welcome-art role-hero-art" />
    </Reveal>
  );
}
export type QuickAction = { key: string; label: string; href: string; hint?: string };
export function QuickActions({ items, ar }: { items: QuickAction[]; ar: boolean }) {
  return (
    <Stagger className="quick-grid">
      {items.map((a, i) => {
        const [from, to, glow] = quickActionPalette[i % quickActionPalette.length];
        return (
          <StaggerItem key={a.key} className="quick-item">
            <Link className="quick-tile" href={a.href} style={{ "--qa-from": from, "--qa-to": to, "--qa-glow": glow } as CSSProperties}>
              <span className="quick-icon"><NavigationIcon page={a.key} /></span>
              <strong>{a.label}</strong>
              <small>{a.hint ?? (ar ? "افتح القسم ←" : "Open section →")}</small>
            </Link>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
export function Avatar({ name, seed }: { name: string; seed: string }) {
  const [from, to] = paletteFor(seed);
  return <span className="gradient-avatar" aria-hidden="true" style={{ "--av-from": from, "--av-to": to } as CSSProperties}>{initials(name)}</span>;
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

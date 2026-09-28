"use client";

import Link from "next/link";
import { CountUp } from "./Charts";
import { Icon } from "./ui";

type Stat = { label: string; value: number; icon: string; href: string; hint?: string };

/** Tuiles de statistiques de l'accueil : les chiffres défilent à l'arrivée. */
export default function HomeStats({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      {stats.map((s, i) => (
        <Link key={s.label} href={s.href} className="card p-3 hover:bg-soft" style={{ ["--i" as string]: i + 1 }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{s.label}</span>
            <Icon name={s.icon} className="text-[17px] text-accent-text" />
          </div>
          <div className="mt-2 text-[28px] font-bold tracking-tight leading-none">
            <CountUp value={s.value} duration={1300} />
          </div>
          {s.hint && <div className="mt-1 text-[11px] text-muted truncate">{s.hint}</div>}
        </Link>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./ui";

// Graphiques et tuiles KPI insérés par l'agent dans ses réponses (blocs ```chart et ```kpi), façon Excel :
// histogramme (colonnes), barres, courbe, aire, secteurs (camembert), anneau, colonnes empilées.
// Couleurs vives demandées par l'utilisateur (bleu, jaune, vert, rouge, violet, orange), lisibles sur fond sombre.
const SERIES = ["#60a5fa", "#facc15", "#4ade80", "#fb7185", "#c084fc", "#fb923c"];
const INK = "#f3f4f6";
const MUTED = "#9ca3af";
const GRID = "#262b36";
const SURFACE = "#12151b";

export type ChartSpec = {
  type: "column" | "bar" | "stacked" | "line" | "area" | "pie" | "donut";
  title?: string;
  subtitle?: string;
  unit?: string;
  labels: string[];
  series: { name: string; data: (number | null)[] }[];
};

export type KpiSpec = { label: string; value: number | string; unit?: string; delta?: string; good?: boolean | null; hint?: string };

// ─── Formatage ───────────────────────────────────────────────────
function fmt(v: number | null | undefined, unit?: string) {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const s =
    abs >= 1_000_000
      ? `${(v / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`
      : abs >= 10_000
        ? `${(v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k`
        : v.toLocaleString("fr-FR", { maximumFractionDigits: abs < 10 ? 2 : abs < 100 ? 1 : 0 });
  return unit ? (unit === "%" ? `${s} %` : `${s} ${unit}`) : s;
}

function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks = [];
  for (let t = 0; t <= max + step * 0.001; t += step) ticks.push(Number(t.toFixed(10)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** Nombre qui défile jusqu'à sa valeur. */
export function CountUp({ value, unit, duration = 1100 }: { value: number; unit?: string; duration?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setV(value);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setV(value * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{fmt(p2(v, value), unit)}</>;
}
// Pendant l'animation, on garde la précision de la valeur finale.
const p2 = (v: number, final: number) => (Number.isInteger(final) ? Math.round(v) : v);

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

// ─── Cadre commun ────────────────────────────────────────────────
function Frame({ spec, children, legend }: { spec: ChartSpec; children: React.ReactNode; legend: boolean }) {
  const [table, setTable] = useState(false);
  return (
    <figure className="not-prose my-4 rounded-xl border border-line bg-[#12151b]/90 p-3.5 reveal holo">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {spec.title && <figcaption className="text-[14px] font-semibold text-ink leading-snug">{spec.title}</figcaption>}
          {spec.subtitle && <div className="text-[12px] text-muted">{spec.subtitle}</div>}
        </div>
        <button
          onClick={() => setTable((t) => !t)}
          className="shrink-0 inline-flex items-center gap-1 rounded-md border border-line px-2 h-6 text-[11px] text-muted hover:text-ink"
        >
          <Icon name={table ? "bar_chart" : "table_rows"} className="text-[14px]" /> {table ? "Graphique" : "Tableau"}
        </button>
      </div>
      {legend && spec.series.length > 1 && !table && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
          {spec.series.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: SERIES[i] }} /> {s.name}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3">{table ? <DataTable spec={spec} /> : children}</div>
    </figure>
  );
}

function DataTable({ spec }: { spec: ChartSpec }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-[12px] tabular-nums">
        <thead>
          <tr className="bg-soft text-muted">
            <th className="text-left font-semibold px-2.5 py-1.5"> </th>
            {spec.series.map((s) => (
              <th key={s.name} className="text-right font-semibold px-2.5 py-1.5">{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.labels.map((l, i) => (
            <tr key={l + i} className="border-t border-line">
              <td className="px-2.5 py-1.5 text-ink">{l}</td>
              {spec.series.map((s) => (
                <td key={s.name} className="px-2.5 py-1.5 text-right text-ink">{fmt(s.data[i], spec.unit)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Barres horizontales (comparaison) ───────────────────────────
function Bars({ spec }: { spec: ChartSpec }) {
  const max = Math.max(0, ...spec.series.flatMap((s) => s.data.map((v) => v ?? 0)));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1] || 1;
  const multi = spec.series.length > 1;
  const [hover, setHover] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {spec.labels.map((label, i) => (
        <div key={label + i} className="reveal" style={{ ["--i" as string]: i }}>
          <div className="text-[12px] text-ink mb-1 truncate" title={label}>{label}</div>
          <div className="space-y-[2px]">
            {spec.series.map((s, si) => {
              const v = s.data[i];
              const pct = v == null ? 0 : Math.max(0, (v / top) * 100);
              const key = `${i}-${si}`;
              return (
                <div
                  key={s.name}
                  className="relative flex items-center gap-2 h-[18px] group"
                  onMouseEnter={() => setHover(key)}
                  onMouseLeave={() => setHover(null)}
                >
                  <div className="relative flex-1 h-full rounded-r-[4px]">
                    <div
                      className="bar-grow h-full rounded-r-[4px]"
                      style={{ width: `${pct}%`, background: SERIES[si], ["--i" as string]: i + si, boxShadow: `0 0 14px ${SERIES[si]}55` }}
                    />
                    {hover === key && (
                      <div className="absolute z-10 -top-8 left-0 whitespace-nowrap rounded-md bg-elev border border-line px-2 py-1 text-[11px] text-ink shadow-xl">
                        {multi ? `${s.name} · ` : ""}{label} : <strong>{fmt(v, spec.unit)}</strong>
                      </div>
                    )}
                  </div>
                  <span className="w-[72px] shrink-0 text-right text-[12px] tabular-nums text-ink">{fmt(v, spec.unit)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Courbe / aire (évolution) ───────────────────────────────────
function Line({ spec, area }: { spec: ChartSpec; area: boolean }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const h = 220;
  const pad = { l: 44, r: 16, t: 14, b: 28 };
  const n = spec.labels.length;
  const all = spec.series.flatMap((s) => s.data.filter((v): v is number => v != null));
  const ticks = niceTicks(Math.max(0, ...all), 4);
  const top = ticks[ticks.length - 1] || 1;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i * (width - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + (1 - v / top) * (h - pad.t - pad.b);
  const every = Math.ceil(n / Math.max(2, Math.floor((width - pad.l) / 70)));

  const paths = spec.series.map((s) => {
    const pts = s.data.map((v, i) => (v == null ? null : [x(i), y(v)] as const)).filter(Boolean) as (readonly [number, number])[];
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const areaD = pts.length ? `${d} L${pts[pts.length - 1][0]},${y(0)} L${pts[0][0]},${y(0)} Z` : "";
    return { d, len: Math.ceil(len) + 2, areaD, last: pts[pts.length - 1] };
  });

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - pad.l) / (width - pad.l - pad.r)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={h} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block overflow-visible">
        <defs>
          {spec.series.map((_, i) => (
            <linearGradient key={i} id={`area-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={SERIES[i]} stopOpacity={0.28} />
              <stop offset="1" stopColor={SERIES[i]} stopOpacity={0} />
            </linearGradient>
          ))}
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED} className="tabular-nums">
              {fmt(t)}
            </text>
          </g>
        ))}
        {spec.labels.map((l, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={l + i} x={x(i)} y={h - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill={MUTED}>
              {l}
            </text>
          ) : null,
        )}
        {area &&
          paths.map((p, i) => <path key={`a${i}`} d={p.areaD} fill={`url(#area-${i})`} className="fade-in" style={{ ["--d" as string]: "0.6s" }} />)}
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke={SERIES[i]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            filter="url(#glow)"
            className="line-draw"
            style={{ ["--len" as string]: p.len, ["--i" as string]: i }}
          />
        ))}
        {paths.map((p, i) =>
          p.last ? (
            <g key={`e${i}`} className="fade-in" style={{ ["--d" as string]: "1.3s" }}>
              <circle cx={p.last[0]} cy={p.last[1]} r={6} fill={SURFACE} />
              <circle cx={p.last[0]} cy={p.last[1]} r={4} fill={SERIES[i]} />
            </g>
          ) : null,
        )}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={h - pad.b} stroke={MUTED} strokeWidth={1} strokeOpacity={0.5} />
            {spec.series.map((s, i) =>
              s.data[hover] != null ? (
                <g key={s.name}>
                  <circle cx={x(hover)} cy={y(s.data[hover]!)} r={6} fill={SURFACE} />
                  <circle cx={x(hover)} cy={y(s.data[hover]!)} r={4} fill={SERIES[i]} />
                </g>
              ) : null,
            )}
          </g>
        )}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute z-10 rounded-md bg-elev border border-line px-2.5 py-1.5 text-[11px] text-ink shadow-xl"
          style={{ left: Math.min(Math.max(x(hover) - 60, 0), width - 150), top: 0 }}
        >
          <div className="font-semibold mb-0.5">{spec.labels[hover]}</div>
          {spec.series.map((s, i) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: SERIES[i] }} />
              <span className="text-muted">{s.name}</span>
              <strong className="ml-auto pl-3 tabular-nums">{fmt(s.data[hover], spec.unit)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Histogramme : colonnes verticales, groupées ou empilées (comme Excel) ──
function Columns({ spec, stacked }: { spec: ChartSpec; stacked: boolean }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<{ i: number; s: number } | null>(null);
  const h = 250;
  const n = spec.labels.length;
  const dense = n > 12; // beaucoup de colonnes (ex. 30 jours) : on allège les étiquettes
  const rotate = !dense && (n > 6 || spec.labels.some((l) => l.length > 12));
  const pad = { l: 46, r: 10, t: 22, b: rotate ? 64 : 30 };
  const single = spec.series.length === 1;
  const totals = spec.labels.map((_, i) => spec.series.reduce((a, s) => a + Math.max(0, s.data[i] ?? 0), 0));
  const max = stacked ? Math.max(0, ...totals) : Math.max(0, ...spec.series.flatMap((s) => s.data.map((v) => v ?? 0)));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1] || 1;
  const plotW = width - pad.l - pad.r;
  const slot = plotW / Math.max(1, n);
  const groupW = slot * 0.72;
  const barW = stacked || single ? groupW : groupW / spec.series.length;
  const y = (v: number) => pad.t + (1 - v / top) * (h - pad.t - pad.b);
  // Une seule série : chaque colonne a sa couleur (« varier les couleurs par point », comme Excel).
  const color = (i: number, s: number) => (single && !dense ? SERIES[i % SERIES.length] : SERIES[s]);
  const every = dense ? Math.ceil(n / Math.max(2, Math.floor(plotW / 48))) : 1;
  const peak = totals.indexOf(Math.max(...totals));
  const showValue = (i: number) => (single || stacked) && (!dense || i === peak);

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={h} className="block overflow-visible" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED} className="tabular-nums">
              {fmt(t)}
            </text>
          </g>
        ))}
        {spec.labels.map((label, i) => {
          const x0 = pad.l + i * slot + (slot - groupW) / 2;
          let base = 0;
          return (
            <g key={label + i}>
              {spec.series.map((s, si) => {
                const v = Math.max(0, s.data[i] ?? 0);
                const x = stacked || single ? x0 : x0 + si * barW;
                const yTop = y(base + v);
                const hBar = y(base) - yTop;
                if (stacked) base += v;
                const active = hover?.i === i && hover?.s === si;
                return (
                  <rect
                    key={s.name}
                    x={x + 1}
                    y={yTop}
                    width={Math.max(2, barW - 2)}
                    height={Math.max(0, hBar)}
                    rx={stacked ? 0 : 4}
                    fill={color(i, si)}
                    opacity={hover && !active ? 0.55 : 1}
                    className="col-grow"
                    style={{ ["--i" as string]: i, filter: `drop-shadow(0 0 8px ${color(i, si)}55)` }}
                    onMouseEnter={() => setHover({ i, s: si })}
                  />
                );
              })}
              {/* Valeur au-dessus de la colonne (total si empilé) */}
              {showValue(i) && (
                <text x={x0 + groupW / 2} y={y(stacked ? totals[i] : Math.max(0, spec.series[0].data[i] ?? 0)) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK} className="fade-in tabular-nums" style={{ ["--d" as string]: "0.9s" }}>
                  {fmt(stacked ? totals[i] : spec.series[0].data[i], spec.unit)}
                </text>
              )}
              {(i % every === 0 || i === n - 1) && <text
                x={x0 + groupW / 2}
                y={h - pad.b + 16}
                textAnchor={rotate ? "end" : "middle"}
                fontSize={11}
                fill={MUTED}
                transform={rotate ? `rotate(-35 ${x0 + groupW / 2} ${h - pad.b + 16})` : undefined}
              >
                {label.length > 22 ? `${label.slice(0, 21)}…` : label}
              </text>}
            </g>
          );
        })}
        <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke={MUTED} strokeOpacity={0.5} />
      </svg>
      {hover && (
        <div className="pointer-events-none absolute z-10 rounded-md bg-elev border border-line px-2.5 py-1.5 text-[11px] text-ink shadow-xl" style={{ left: Math.min(Math.max(pad.l + hover.i * slot - 30, 0), width - 170), top: 0 }}>
          <div className="font-semibold">{spec.labels[hover.i]}</div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: color(hover.i, hover.s) }} />
            {spec.series.length > 1 && <span className="text-muted">{spec.series[hover.s].name}</span>}
            <strong className="ml-auto pl-3 tabular-nums">{fmt(spec.series[hover.s].data[hover.i], spec.unit)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Secteurs (camembert plein) ──────────────────────────────────
function Pie({ spec }: { spec: ChartSpec }) {
  const values = spec.series[0]?.data.map((v) => Math.max(0, v ?? 0)) ?? [];
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const [hover, setHover] = useState<number | null>(null);
  const R = 84;
  const c = 100;
  let angle = -Math.PI / 2;
  const slices = values.map((v, i) => {
    const a0 = angle;
    const a1 = angle + (v / total) * Math.PI * 2;
    angle = a1;
    const mid = (a0 + a1) / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, r = R) => `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`;
    const d = values.filter((x) => x > 0).length === 1 && v > 0 ? `M${c - R},${c} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0` : `M${c},${c} L${p(a0)} A${R},${R} 0 ${large} 1 ${p(a1)} Z`;
    return { d, mid, pct: (v / total) * 100, color: SERIES[i % SERIES.length], i };
  });

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <svg width={200} height={200} viewBox="0 0 200 200" className="donut-in shrink-0">
        {slices.map((s) => (
          <path
            key={s.i}
            d={s.d}
            fill={s.color}
            stroke={SURFACE}
            strokeWidth={2}
            onMouseEnter={() => setHover(s.i)}
            onMouseLeave={() => setHover(null)}
            style={{
              transform: hover === s.i ? `translate(${Math.cos(s.mid) * 6}px, ${Math.sin(s.mid) * 6}px)` : undefined,
              transition: "transform 0.2s",
              filter: `drop-shadow(0 0 6px ${s.color}55)`,
            }}
          />
        ))}
        {slices.map((s) =>
          s.pct >= 7 ? (
            <text key={`t${s.i}`} x={c + R * 0.62 * Math.cos(s.mid)} y={c + R * 0.62 * Math.sin(s.mid) + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#0b0d11" className="pointer-events-none">
              {Math.round(s.pct)} %
            </text>
          ) : null,
        )}
      </svg>
      <ul className="w-full space-y-1.5">
        {values.map((v, i) => (
          <li key={i} className={`flex items-center gap-2 rounded-md px-2 py-1 text-[12px] reveal ${hover === i ? "bg-soft" : ""}`} style={{ ["--i" as string]: i }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="size-2.5 rounded-full shrink-0" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="flex-1 truncate text-ink">{spec.labels[i]}</span>
            <span className="tabular-nums text-ink">{fmt(v, spec.unit)}</span>
            <span className="w-10 text-right tabular-nums text-muted">{Math.round((v / total) * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Anneau (répartition) ────────────────────────────────────────
function Donut({ spec }: { spec: ChartSpec }) {
  const values = spec.series[0]?.data.map((v) => Math.max(0, v ?? 0)) ?? [];
  // 6 parts max : le reste est regroupé dans « Autres ».
  let labels = spec.labels;
  let vals = values;
  if (vals.length > 6) {
    const order = vals.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
    const keep = order.slice(0, 5).map(([, i]) => i).sort((a, b) => a - b);
    labels = [...keep.map((i) => spec.labels[i]), "Autres"];
    vals = [...keep.map((i) => values[i]), order.slice(5).reduce((s, [v]) => s + v, 0)];
  }
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const [hover, setHover] = useState<number | null>(null);
  const R = 70;
  const C = 2 * Math.PI * R;
  const gap = 3;
  let acc = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="relative shrink-0">
        <svg width={180} height={180} viewBox="0 0 180 180" className="donut-in">
          <circle cx={90} cy={90} r={R} fill="none" stroke={GRID} strokeWidth={18} />
          {vals.map((v, i) => {
            const len = Math.max(0, (v / total) * C - gap);
            const off = acc;
            acc += (v / total) * C;
            return (
              <circle
                key={i}
                cx={90}
                cy={90}
                r={R}
                fill="none"
                stroke={SERIES[i]}
                strokeWidth={hover === i ? 22 : 18}
                strokeDasharray={`${len} ${C}`}
                strokeDashoffset={-off}
                className="transition-[stroke-width]"
                style={{ filter: `drop-shadow(0 0 6px ${SERIES[i]}66)` }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-[20px] font-bold text-ink leading-none">
              {hover != null ? fmt(vals[hover], spec.unit) : <CountUp value={total} unit={spec.unit} />}
            </div>
            <div className="text-[11px] text-muted mt-1">{hover != null ? labels[hover] : "Total"}</div>
          </div>
        </div>
      </div>
      <ul className="w-full space-y-1.5">
        {vals.map((v, i) => (
          <li
            key={i}
            className={`flex items-center gap-2 rounded-md px-2 py-1 text-[12px] reveal ${hover === i ? "bg-soft" : ""}`}
            style={{ ["--i" as string]: i }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="size-2.5 rounded-sm shrink-0" style={{ background: SERIES[i] }} />
            <span className="flex-1 truncate text-ink">{labels[i]}</span>
            <span className="tabular-nums text-ink">{fmt(v, spec.unit)}</span>
            <span className="w-10 text-right tabular-nums text-muted">{Math.round((v / total) * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Points d'entrée (blocs ```chart / ```kpi) ────────────────────
function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function Preparing({ label }: { label: string }) {
  return (
    <div className="my-4 rounded-xl border border-line p-3.5">
      <div className="text-[12px] text-muted mb-2 flex items-center gap-1.5">
        <Icon name="monitoring" className="text-[16px] text-cyan" /> {label}
      </div>
      <div className="skeleton h-28 rounded-lg" />
    </div>
  );
}

export function ChartBlock({ raw }: { raw: string }) {
  const spec = useMemo(() => parse<ChartSpec>(raw), [raw]);
  if (!spec || !Array.isArray(spec.labels) || !Array.isArray(spec.series) || !spec.series.length) {
    return <Preparing label="Graphique en préparation…" />;
  }
  // Une seule échelle : 6 séries max (ordre fixe de la palette).
  const clean: ChartSpec = {
    ...spec,
    type: chartType(spec.type, spec.labels.length),
    series: spec.series.slice(0, 6).map((s) => ({ ...s, data: s.data.map((v) => (v == null ? null : Number(v))) })),
  };
  if (clean.type === "pie") return <Frame spec={clean} legend={false}><Pie spec={clean} /></Frame>;
  if (clean.type === "donut") return <Frame spec={clean} legend={false}><Donut spec={clean} /></Frame>;
  if (clean.type === "line" || clean.type === "area") return <Frame spec={clean} legend><Line spec={clean} area={clean.type === "area"} /></Frame>;
  if (clean.type === "column" || clean.type === "stacked") return <Frame spec={clean} legend><Columns spec={clean} stacked={clean.type === "stacked"} /></Frame>;
  return <Frame spec={clean} legend><Bars spec={clean} /></Frame>;
}

/** Noms de graphiques acceptés (français / anglais / Excel) → type interne. */
function chartType(raw: unknown, n: number): ChartSpec["type"] {
  const t = String(raw ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/pie|camembert|secteur|cercle|circulaire/.test(t)) return "pie";
  if (/donut|anneau|doughnut/.test(t)) return "donut";
  if (/stack|empil/.test(t)) return "stacked";
  if (/area|aire/.test(t)) return "area";
  if (/line|courbe|evolution/.test(t)) return "line";
  if (/column|colonne|histogram|vertical/.test(t)) return "column";
  // « bar » : colonnes verticales comme Excel, sauf demande explicite d'horizontal ou beaucoup de catégories.
  if (/bar|barre|horizontal/.test(t)) return t.includes("horizontal") || t === "hbar" || n > 10 ? "bar" : "column";
  return "column";
}

export function KpiBlock({ raw }: { raw: string }) {
  const items = useMemo(() => parse<KpiSpec[]>(raw), [raw]);
  if (!Array.isArray(items)) return <Preparing label="Indicateurs en préparation…" />;
  return (
    <div className="not-prose my-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {items.slice(0, 9).map((k, i) => {
        const num = typeof k.value === "number" ? k.value : Number(String(k.value).replace(/\s/g, "").replace(",", "."));
        const tone = k.good == null ? "text-muted" : k.good ? "text-ok" : "text-danger";
        return (
          <div key={k.label + i} className="card holo reveal p-3" style={{ ["--i" as string]: i }}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted truncate">{k.label}</div>
            <div className="mt-1.5 text-[24px] font-bold tracking-tight text-ink leading-none">
              {Number.isFinite(num) ? <CountUp value={num} unit={k.unit} /> : String(k.value)}
            </div>
            {k.delta && (
              <div className={`mt-1.5 inline-flex items-center gap-0.5 text-[12px] font-semibold ${tone}`}>
                <Icon name={/^[-−]/.test(k.delta) ? "arrow_downward" : "arrow_upward"} className="text-[14px]" />
                {k.delta}
                {k.good != null && <span className="sr-only">{k.good ? " (favorable)" : " (défavorable)"}</span>}
              </div>
            )}
            {k.hint && <div className="mt-1 text-[11px] text-muted truncate">{k.hint}</div>}
          </div>
        );
      })}
    </div>
  );
}

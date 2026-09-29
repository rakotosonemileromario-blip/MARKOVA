// Petits éléments d'interface partagés (icônes, logo, étiquettes).

export function Icon({ name, className = "", filled = false, style }: { name: string; className?: string; filled?: boolean; style?: React.CSSProperties }) {
  return (
    <span className={`icon ${filled ? "filled" : ""} ${className}`} style={style} aria-hidden>
      {name}
    </span>
  );
}

/** Monogramme MARKOVA : un « M » à facettes, indigo à gauche, cyan à droite. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="MARKOVA" role="img">
      <defs>
        <linearGradient id="mk-l" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
        <linearGradient id="mk-r" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#0891b2" />
        </linearGradient>
      </defs>
      <polygon points="32,4 40,17 32,13 24,17" fill="#6366f1" />
      <polygon points="21,19 32,40 32,44 25,34 16,52 7,50" fill="url(#mk-l)" />
      <polygon points="16,52 25,44 22,52" fill="#4338ca" />
      <polygon points="43,19 32,40 32,44 39,34 48,52 57,50" fill="url(#mk-r)" />
      <polygon points="48,52 39,44 42,52" fill="#0e7490" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid place-items-center rounded-lg bg-soft border border-line p-1">
        <LogoMark size={compact ? 24 : 28} />
      </div>
      <div className="leading-tight">
        <div className="font-bold tracking-[0.04em] text-[15px] text-holo">MARKOVA</div>
        {!compact && <div className="text-[11px] text-muted">Marketing Intelligence</div>}
      </div>
    </div>
  );
}

const TAGS: Record<string, { label: string; cls: string }> = {
  FAIT: { label: "Fait", cls: "bg-soft text-muted border border-line" },
  WEB: { label: "Web", cls: "bg-cyan-soft text-cyan" },
  INTERPRETATION: { label: "Interprétation", cls: "bg-cyan-soft text-cyan" },
  HYPOTHESE: { label: "Hypothèse", cls: "bg-violet-soft text-violet" },
  RECOMMANDATION: { label: "Recommandation", cls: "bg-accent-soft text-accent-text" },
  POURQUOI: { label: "Pourquoi", cls: "bg-cyan-soft text-cyan" },
  COMMENT: { label: "Comment", cls: "bg-violet-soft text-violet" },
  ALERTE: { label: "Alerte", cls: "bg-danger-soft text-danger" },
  VALIDATION: { label: "À valider", cls: "bg-warn-soft text-warn" },
  PRIORITE: { label: "Priorité", cls: "bg-warn-soft text-warn" },
};

export const TAG_KEYS = Object.keys(TAGS);

export function normalizeTag(raw: string) {
  return raw.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function Tag({ kind }: { kind: string }) {
  const t = TAGS[normalizeTag(kind)];
  if (!t) return null;
  return <span className={`tag ${t.cls}`}>{t.label}</span>;
}

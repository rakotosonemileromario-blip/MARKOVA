// Petits éléments d'interface partagés (icônes, logo, étiquettes).

export function Icon({ name, className = "", filled = false, style }: { name: string; className?: string; filled?: boolean; style?: React.CSSProperties }) {
  return (
    <span className={`icon ${filled ? "filled" : ""} ${className}`} style={style} aria-hidden>
      {name}
    </span>
  );
}

/** Logo MARKOVA : l'illustration de l'utilisateur (public/logo.png, recadrée sur la tête). */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo.png" width={size} height={size} alt="MARKOVA" className="rounded-lg object-cover shrink-0" style={{ width: size, height: size }} />
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

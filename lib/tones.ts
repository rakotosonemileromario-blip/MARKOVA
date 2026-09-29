"use client";

import { useEffect, useState } from "react";

// Couleurs vives de l'interface : chaque onglet reçoit une couleur, tirée au hasard à chaque session.

export const TONES = {
  jaune: { fg: "#facc15", soft: "rgba(250, 204, 21, 0.14)" },
  rouge: { fg: "#fb7185", soft: "rgba(244, 63, 94, 0.15)" },
  vert: { fg: "#4ade80", soft: "rgba(34, 197, 94, 0.14)" },
  violet: { fg: "#c084fc", soft: "rgba(168, 85, 247, 0.16)" },
  bleu: { fg: "#60a5fa", soft: "rgba(59, 130, 246, 0.16)" },
} as const;

export type Tone = (typeof TONES)[keyof typeof TONES];
const LIST = Object.values(TONES);
const KEY = "markova_tones_seed";

function seed() {
  try {
    let s = sessionStorage.getItem(KEY);
    if (!s) sessionStorage.setItem(KEY, (s = String(Math.floor(Math.random() * 1e9))));
    return Number(s);
  } catch {
    return Math.floor(Math.random() * 1e9);
  }
}

/** Mélange déterministe pour une graine donnée (même ordre dans toute la session). */
function shuffled(n: number) {
  const a = [...LIST];
  let x = n || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Couleur de chaque clé (onglet), stable pendant la session, différente d'une session à l'autre. */
export function useTones(keys: string[]): Record<string, Tone> {
  const [order, setOrder] = useState<Tone[]>(LIST);
  useEffect(() => setOrder(shuffled(seed())), []);
  return Object.fromEntries(keys.map((k, i) => [k, order[i % order.length]]));
}

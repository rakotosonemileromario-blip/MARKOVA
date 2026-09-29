"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Animation d'apparition au défilement : les blocs situés plus bas glissent et s'éclaircissent
// quand ils arrivent à l'écran, avec un léger décalage entre voisins. Les blocs déjà visibles
// au chargement gardent leur animation d'entrée. Désactivé si l'appareil demande moins d'animations.

const SELECTOR = "main .card, main section, main figure, main .md > *";
const DONE = "data-sr";

export default function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const seen = new WeakSet<Element>();
    const measured = new WeakSet<Element>();
    const hidden = new Set<HTMLElement>();
    let batch = 0;
    let batchTimer: ReturnType<typeof setTimeout> | undefined;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (!measured.has(el)) {
            // Première mesure : visible → pas d'animation ; hors écran → caché jusqu'à son arrivée.
            measured.add(el);
            if (e.isIntersecting) {
              io.unobserve(el);
              el.setAttribute(DONE, "");
            } else {
              el.classList.add("sr");
              hidden.add(el);
            }
            continue;
          }
          if (!e.isIntersecting) continue;
          el.style.transitionDelay = `${Math.min(batch++, 6) * 70}ms`; // cascade entre voisins
          el.classList.add("sr-in");
          el.setAttribute(DONE, "");
          hidden.delete(el);
          io.unobserve(el);
          clearTimeout(batchTimer);
          batchTimer = setTimeout(() => (batch = 0), 120);
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.06 },
    );

    const scan = () => {
      for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
        if (seen.has(el) || el.hasAttribute(DONE)) continue;
        seen.add(el);
        if (el.parentElement?.closest(SELECTOR)) continue; // suit son bloc parent
        io.observe(el);
      }
    };

    const first = requestAnimationFrame(scan);
    const mo = new MutationObserver(() => requestAnimationFrame(scan));
    mo.observe(document.querySelector("main") ?? document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(first);
      io.disconnect();
      mo.disconnect();
      clearTimeout(batchTimer);
      // Blocs pas encore apparus : on les rend visibles (changement de page, double montage en développement).
      for (const el of hidden) el.classList.remove("sr");
    };
  }, [pathname]);

  return null;
}

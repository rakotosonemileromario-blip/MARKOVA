"use client";

import { useEffect } from "react";
import { NOTIFICATIONS_EVENT } from "./NotificationBell";
import { REFRESH_EVENT } from "./Sidebar";

const TZ_COOKIE = "markova_tz";

/**
 * Envoie au serveur le fuseau horaire de l'appareil utilisé (PC ou téléphone) :
 * cookie pour les réponses du chat, user_settings pour la surveillance et le rapport hebdo.
 * Enregistre aussi le service worker des notifications push.
 */
export default function DeviceSync() {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const current = document.cookie.match(/(?:^|; )markova_tz=([^;]*)/)?.[1];
    if (tz && decodeURIComponent(current ?? "") !== tz) {
      document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
      fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: tz }) }).catch(() => {});
    }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  // Hauteur réelle de l'écran : dans l'APK, « 100dvh » compte une barre d'outils invisible et
  // pousse la barre du bas sous la barre système. On mesure la zone vraiment visible.
  useEffect(() => {
    const set = () => {
      const h = Math.round(window.visualViewport?.height ?? window.innerHeight);
      document.documentElement.style.setProperty("--app-h", `${Math.min(h, window.innerHeight)}px`);
    };
    set();
    window.addEventListener("resize", set);
    window.visualViewport?.addEventListener("resize", set);
    return () => {
      window.removeEventListener("resize", set);
      window.visualViewport?.removeEventListener("resize", set);
    };
  }, []);

  // Relances programmées : tant que l'application est ouverte, elles partent à la minute près.
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const res = await fetch("/api/relances/run", { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (json.done?.length) {
          window.dispatchEvent(new Event(NOTIFICATIONS_EVENT));
          window.dispatchEvent(new Event(REFRESH_EVENT));
        }
      } catch {
        // hors ligne : on réessaiera à la minute suivante
      } finally {
        running = false;
      }
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  return null;
}

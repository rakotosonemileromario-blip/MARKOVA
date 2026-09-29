"use client";

import { useEffect } from "react";

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
  return null;
}

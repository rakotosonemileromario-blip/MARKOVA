"use client";

import { useEffect, useState } from "react";
import { enablePush, pushStatus, refreshPushSilently, type PushStatus } from "@/lib/push-client";
import { Icon } from "./ui";

const LATER_KEY = "markova:push-later";
const LATER_DAYS = 3;

/**
 * Invitation à activer les notifications sur cet appareil (téléphone, APK, PC).
 * Revient tous les 3 jours tant qu'elles ne sont pas activées ; une fois activées, on ne la voit plus.
 */
export default function PushPrompt() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await refreshPushSilently();
      const s = await pushStatus();
      let later = 0;
      try {
        later = Number(localStorage.getItem(LATER_KEY) ?? 0);
      } catch {}
      if (Date.now() - later < LATER_DAYS * 86_400_000) return;
      if (s === "inactif" || s === "bloque") setStatus(s);
    })();
  }, []);

  if (!status) return null;

  function later() {
    try {
      localStorage.setItem(LATER_KEY, String(Date.now()));
    } catch {}
    setStatus(null);
  }

  async function activate() {
    setBusy(true);
    setMessage(null);
    try {
      const s = await enablePush(true);
      if (s === "actif") {
        setMessage("✅ C'est activé ! Une notification de test arrive.");
        setTimeout(() => setStatus(null), 3500);
      } else if (s === "bloque") setStatus("bloque");
      else setMessage("Tu n'as pas accepté. Tu pourras le faire plus tard dans « Alertes ».");
    } catch (err) {
      setMessage(`⚠️ ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed z-40 left-3 right-3 bottom-[84px] md:left-auto md:right-5 md:bottom-5 md:w-[380px] reveal" role="dialog" aria-label="Activer les notifications">
      <div className="card p-4 shadow-2xl border-accent/50 bg-panel">
        <div className="flex items-start gap-3">
          <span className="grid place-items-center size-11 rounded-2xl bg-accent-soft shrink-0">
            <Icon name={status === "bloque" ? "notifications_off" : "notifications_active"} filled className="text-[26px] text-accent-text" />
          </span>
          <div className="flex-1 min-w-0">
            {status === "bloque" ? (
              <>
                <div className="text-[16px] font-bold leading-snug">Les notifications sont bloquées</div>
                <p className="mt-1 text-[14px] text-muted leading-snug">
                  Pour les recevoir : <b className="text-ink">Paramètres du téléphone → Applications → MARKOVA → Notifications → Autoriser</b>. Puis reviens ici.
                </p>
              </>
            ) : (
              <>
                <div className="text-[16px] font-bold leading-snug">Recevoir les alertes de Kimia sur cet appareil ?</div>
                <p className="mt-1 text-[14px] text-muted leading-snug">
                  Problème sur une campagne, changement de prix d&apos;un concurrent, rapport du lundi, étude prête… même quand l&apos;application est fermée.
                </p>
              </>
            )}
          </div>
        </div>
        {message && <p className="mt-2 text-[14px]">{message}</p>}
        <div className="mt-3 flex gap-2">
          {status === "inactif" && (
            <button onClick={activate} disabled={busy} className="btn btn-primary flex-1">
              <Icon name="notifications_active" className="text-[20px]" /> {busy ? "Un instant…" : "Oui, activer"}
            </button>
          )}
          <button onClick={later} className={`btn ${status === "bloque" ? "flex-1" : ""}`}>
            {status === "bloque" ? "Compris" : "Plus tard"}
          </button>
        </div>
      </div>
    </div>
  );
}

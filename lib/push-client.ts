"use client";

// Notifications push sur cet appareil (PC, téléphone, APK Android).
// Dans l'APK, Chrome confie la demande d'autorisation à l'application : Android affiche alors sa propre
// fenêtre « Autoriser MARKOVA à envoyer des notifications ? », et les notifications arrivent au nom de MARKOVA.

export type PushStatus = "actif" | "inactif" | "bloque" | "indisponible" | "sans-cles";

/** Clé publique VAPID, réduite à sa première ligne (au cas où elle aurait été collée deux fois). */
const publicKey = () => (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").split(/[\r\n]+/).map((l) => l.trim()).find(Boolean) ?? "";

function toUint8(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/sw.js")) ?? (await navigator.serviceWorker.register("/sw.js"));
}

export async function pushStatus(): Promise<PushStatus> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "indisponible";
  if (!publicKey()) return "sans-cles";
  if (Notification.permission === "denied") return "bloque";
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return (await reg?.pushManager.getSubscription()) && Notification.permission === "granted" ? "actif" : "inactif";
}

/** Nom lisible de l'appareil (affiché dans la liste des abonnements). */
function deviceName() {
  const ua = navigator.userAgent;
  const apk = document.referrer.startsWith("android-app://") || window.matchMedia("(display-mode: standalone)").matches;
  const kind = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "PC Windows" : /Mac/i.test(ua) ? "Mac" : "Appareil";
  return `${kind}${apk ? " · application" : " · navigateur"}`;
}

/**
 * Demande l'autorisation (fenêtre du téléphone), abonne l'appareil et envoie une notification de test.
 * À appeler depuis un clic : les navigateurs refusent la demande sans geste de l'utilisateur.
 */
export async function enablePush(test = true): Promise<PushStatus> {
  const status = await pushStatus();
  if (status === "indisponible" || status === "sans-cles" || status === "bloque") return status;
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "bloque" : "inactif";
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toUint8(publicKey()) }));
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON(), device: deviceName(), test }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Abonnement refusé par le serveur");
  return "actif";
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  }
}

/** Abonnement silencieux : si l'autorisation est déjà donnée, on (ré)abonne l'appareil sans rien demander. */
export async function refreshPushSilently() {
  try {
    if ((await pushStatus()) === "inactif" && Notification.permission === "granted") await enablePush(false);
  } catch {
    // sans conséquence : la carte d'activation reste proposée
  }
}

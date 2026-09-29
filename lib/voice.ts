"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Voix gratuite : reconnaissance vocale du navigateur (Chrome, Edge, Android, Safari) pour le texte en direct,
// ET enregistrement audio en parallèle : à l'arrêt, l'audio est retranscrit par le serveur (Gemini), qui connaît
// l'accent malgache, le mélange français / malgache et le vocabulaire marketing. Si le serveur ne répond pas
// à temps, on garde le texte du navigateur. Sans reconnaissance du navigateur (Firefox, WebView) : serveur seul.

const SERVER_TIMEOUT_MS = 20_000;

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Transcription serveur de l'audio, avec le brouillon du navigateur comme indice. */
async function serverTranscribe(blob: Blob, draft: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SERVER_TIMEOUT_MS);
  try {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: await blobToBase64(blob), mimeType: blob.type, draft }),
      signal: ctrl.signal,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Transcription impossible");
    return String(json.text ?? "");
  } finally {
    clearTimeout(timer);
  }
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export type VoiceState = "idle" | "listening" | "transcribing";

/**
 * Dictée : start() écoute sans limite de durée — les pauses ne coupent pas.
 * Le texte arrive en direct dans `transcript` ; `onFinal(texte)` n'est appelé
 * que lorsque l'utilisateur appuie sur stop(). cancel() arrête sans envoyer.
 */
export function useSpeechToText(onFinal: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const media = useRef<MediaRecorder | null>(null);
  const finalText = useRef("");
  const userStopped = useRef(false);
  const cancelled = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const finish = useCallback((text: string) => {
    setState("idle");
    const t = text.trim();
    if (t && !cancelled.current) onFinalRef.current(t);
  }, []);

  // Les deux sources doivent être terminées (texte du navigateur + audio enregistré) avant la transcription finale.
  const pending = useRef({ recognition: false, audio: null as Blob | null | "aucun" });

  const finalize = useCallback(async () => {
    const p = pending.current;
    if (p.recognition || p.audio === null) return; // on attend l'autre source
    const draft = finalText.current.trim();
    if (cancelled.current) return setState("idle");
    if (p.audio === "aucun" || p.audio.size < 2000) {
      if (!draft && p.audio === "aucun") setError("Je n'ai rien entendu. Réessaie en parlant près du micro.");
      return finish(draft);
    }
    setState("transcribing");
    try {
      const text = await serverTranscribe(p.audio, draft);
      setTranscript(text || draft);
      finish(text || draft);
    } catch (err) {
      // Serveur lent ou indisponible : on garde la version du navigateur.
      if (draft) return finish(draft);
      setError(err instanceof Error && err.name !== "AbortError" ? err.message : "Transcription trop lente, réessaie.");
      setState("idle");
    }
  }, [finish]);

  const start = useCallback(async () => {
    setError(null);
    setTranscript("");
    finalText.current = "";
    userStopped.current = false;
    cancelled.current = false;
    stopSpeaking();
    pending.current = { recognition: false, audio: null };
    rec.current = null;
    media.current = null;

    // 1. Enregistrement audio (pour la transcription précise côté serveur).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported?.(t));
      const recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        pending.current.audio = chunks.length ? new Blob(chunks, { type: recorder.mimeType || "audio/webm" }) : "aucun";
        finalize();
      };
      media.current = recorder;
      recorder.start(1000);
    } catch {
      media.current = null;
      pending.current.audio = "aucun";
    }

    // 2. Reconnaissance du navigateur (texte en direct).
    const r = getRecognition();
    if (r) {
      pending.current.recognition = true;
      rec.current = r;
      r.lang = "fr-FR";
      r.interimResults = true;
      r.continuous = true;
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finalText.current += (finalText.current ? " " : "") + res[0].transcript.trim();
          else interim += res[0].transcript;
        }
        setTranscript(finalText.current + (interim ? " " + interim : ""));
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          if (!media.current) setError("Micro refusé : autorise-le dans le navigateur.");
          userStopped.current = true;
        } else if (e.error === "audio-capture" || e.error === "network") {
          // Micro déjà utilisé par l'enregistrement (certains téléphones) ou hors ligne : l'audio suffit.
          if (media.current) userStopped.current = true;
          else setError(`Micro : ${e.error}`);
        } else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Micro : ${e.error}`);
      };
      // Le navigateur coupe après un silence : on relance tant que l'utilisateur n'a pas appuyé sur stop.
      r.onend = () => {
        if (!userStopped.current) {
          try {
            return r.start();
          } catch {
            // relance impossible : on termine
          }
        }
        pending.current.recognition = false;
        finalize();
      };
      try {
        r.start();
      } catch {
        pending.current.recognition = false;
      }
    } else if (!media.current) {
      setError("Micro indisponible sur cet appareil.");
      return;
    }
    setState("listening");
  }, [finalize]);

  /** Arrête l'écoute et envoie ce qui a été dit. */
  const stop = useCallback(() => {
    userStopped.current = true;
    if (rec.current) rec.current.stop();
    if (media.current && media.current.state !== "inactive") media.current.stop();
  }, []);

  /** Arrête l'écoute sans rien envoyer. */
  const cancel = useCallback(() => {
    cancelled.current = true;
    stop();
    setTranscript("");
    setState("idle");
  }, [stop]);

  useEffect(
    () => () => {
      userStopped.current = true;
      cancelled.current = true;
      rec.current?.abort();
      if (media.current && media.current.state !== "inactive") media.current.stop();
    },
    [],
  );

  return { state, transcript, error, start, stop, cancel };
}

// ─── Lecture à voix haute ────────────────────────────────────────
function plain(md: string) {
  return md
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/\[(FAIT|WEB|INTERPR[ÉE]TATION|HYPOTH[ÈE]SE|RECOMMANDATION|POURQUOI|COMMENT|ALERTE|VALIDATION|PRIORIT[ÉE])\]/gi, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#>`|]/g, " ")
    .replace(/^-{3,}$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function speak(markdown: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const text = plain(markdown).slice(0, 4000);
  // Découpage en phrases : évite que certains navigateurs coupent les longs textes.
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((v) => v.lang === "fr-FR" && /natural|neural|google|online/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith("fr"));
  for (const sentence of text.match(/[^.!?]+[.!?]*/g) ?? [text]) {
    const u = new SpeechSynthesisUtterance(sentence.trim());
    u.lang = "fr-FR";
    if (voice) u.voice = voice;
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  }
}

/**
 * Lit un RÉSUMÉ de la réponse, jamais la réponse entière : le bloc ```vocal s'il existe,
 * sinon un résumé parlé demandé au serveur, sinon le début de la réponse.
 */
export async function speakSummary(markdown: string, vocal?: string | null) {
  if (vocal) return speak(vocal);
  stopSpeaking();
  try {
    const res = await fetch("/api/resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: markdown.slice(0, 20_000) }) });
    const json = await res.json();
    if (res.ok && json.text) return speak(json.text);
  } catch {
    // repli ci-dessous
  }
  const words = plain(markdown).split(" ");
  speak(words.slice(0, 70).join(" ") + (words.length > 70 ? ". Le détail est affiché à l'écran." : ""));
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

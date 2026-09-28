"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Voix gratuite : reconnaissance vocale du navigateur (Chrome, Edge, Android, Safari).
// Sans elle (ex. Firefox, WebView d'APK) : enregistrement audio transcrit par le serveur.

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

  const start = useCallback(async () => {
    setError(null);
    setTranscript("");
    finalText.current = "";
    userStopped.current = false;
    cancelled.current = false;
    stopSpeaking();

    const r = getRecognition();
    if (r) {
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
          setError("Micro refusé : autorise-le dans le navigateur.");
          userStopped.current = true;
        } else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Micro : ${e.error}`);
      };
      // Le navigateur coupe après un silence : on relance tant que l'utilisateur n'a pas appuyé sur stop.
      r.onend = () => {
        if (userStopped.current) return finish(finalText.current);
        try {
          r.start();
        } catch {
          finish(finalText.current);
        }
      };
      r.start();
      setState("listening");
      return;
    }

    // Repli : enregistrement puis transcription serveur.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec2 = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec2.ondataavailable = (e) => chunks.push(e.data);
      rec2.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (cancelled.current) return setState("idle");
        setState("transcribing");
        try {
          const blob = new Blob(chunks, { type: rec2.mimeType || "audio/webm" });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          const data = btoa(bin);
          const res = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data, mimeType: blob.type }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "Transcription impossible");
          setTranscript(json.text);
          finish(json.text);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setState("idle");
        }
      };
      media.current = rec2;
      rec2.start();
      setState("listening");
    } catch {
      setError("Micro indisponible sur cet appareil.");
    }
  }, [finish]);

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
      rec.current?.abort();
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

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

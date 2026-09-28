"use client";

import { useRouter } from "next/navigation";
import { useSpeechToText } from "@/lib/voice";
import { Icon } from "./ui";
import Orb from "./Orb";

/**
 * Grand orbe vocal de l'accueil : on parle aussi longtemps qu'on veut, puis Stop.
 * La demande part dans le chat, où la réponse est lue à voix haute et le micro reste disponible.
 */
export default function VoiceHero() {
  const router = useRouter();
  const { state, transcript, error, start, stop, cancel } = useSpeechToText((text) => {
    router.push(`/chat?q=${encodeURIComponent(text)}&send=1&voice=1`);
  });
  const listening = state !== "idle";

  return (
    <section
      className={`card relative overflow-hidden px-4 py-9 flex flex-col items-center text-center ${listening ? "is-active border-danger/40" : ""}`}
      style={{ ["--i" as string]: 1 }}
    >
      <button
        onClick={listening ? stop : start}
        disabled={state === "transcribing"}
        aria-label={listening ? "Stop et envoyer" : "Parler à MARKOVA"}
        className="relative grid place-items-center size-32 rounded-full disabled:opacity-60"
      >
        <span className="absolute top-2 left-2">
          <Orb size={112} state={listening ? "listening" : "idle"} />
        </span>
        <span className="relative grid place-items-center size-14 rounded-full bg-black/25 backdrop-blur-sm border border-white/20 text-white">
          <Icon name={listening ? "stop" : "mic"} filled className="text-[30px]" />
        </span>
      </button>

      <div className="mt-6 font-semibold text-[19px]">
        {state === "transcribing" ? (
          "Transcription…"
        ) : listening ? (
          <span className="inline-flex items-center gap-2 text-danger">
            Je t'écoute
            <span className="eq flex items-center h-5" aria-hidden>
              <span /><span /><span /><span /><span />
            </span>
          </span>
        ) : (
          <span className="text-holo">Parler à MARKOVA</span>
        )}
      </div>

      {listening ? (
        <>
          <p className="mt-3 w-full max-w-md min-h-[48px] max-h-40 overflow-y-auto rounded-lg bg-panel/80 border border-line px-3 py-2 text-left text-[15px] leading-relaxed">
            {transcript || <span className="text-muted">Parle, les pauses ne coupent pas l'écoute…</span>}
          </p>
          <div className="mt-3 flex gap-2 w-full max-w-md">
            <button onClick={cancel} className="rounded-lg border border-line h-11 px-4 text-[14px] font-semibold text-muted">
              Annuler
            </button>
            <button
              onClick={stop}
              disabled={state === "transcribing"}
              className="flex-1 rounded-lg bg-danger text-white h-11 text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60 shine"
            >
              <Icon name="stop" filled className="text-[20px]" /> Stop · Envoyer
            </button>
          </div>
        </>
      ) : (
        <p className="mt-1.5 text-[13px] text-muted min-h-[20px] max-w-md">
          {error ? <span className="text-danger">{error}</span> : "Touche l'orbe, parle aussi longtemps que tu veux, puis appuie sur Stop."}
        </p>
      )}
    </section>
  );
}

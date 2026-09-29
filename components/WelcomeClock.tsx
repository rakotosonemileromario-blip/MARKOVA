"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function greeting(hour: number) {
  if (hour < 5) return "Bonne nuit";
  if (hour < 12) return "Bonjour";
  if (hour < 18) return "Bon après-midi";
  return "Bonsoir";
}

/** « Bienvenue Mario » + date et heure en temps réel, dans le fuseau de l'appareil. */
export default function WelcomeClock({ name: initialName }: { name: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const [name, setName] = useState(initialName);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  async function rename() {
    const next = window.prompt("Comment MARKOVA doit-il t'appeler ?", name)?.trim();
    if (!next || next === name) return;
    setName(next);
    await createClient().auth.updateUser({ data: { name: next } });
  }

  const time = now?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) ?? "--:--";
  const seconds = now ? String(now.getSeconds()).padStart(2, "0") : "--";
  const date = now?.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) ?? "";

  return (
    <section className="reveal">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-muted">{now ? greeting(now.getHours()) : "Bonjour"} 👋</p>
          <h1 className="text-[30px] leading-tight font-bold tracking-tight">
            Bienvenue{" "}
            <button onClick={rename} className="underline-offset-4 hover:underline" title="Changer le nom">
              {name}
            </button>
          </h1>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[30px] leading-none font-bold tabular-nums tracking-tight">
            <span className="text-holo">{time}</span>
            <span className="text-[15px] text-muted align-top ml-0.5">{seconds}</span>
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-[13px] text-muted capitalize flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-[#4ade80] animate-pulse" /> {date}
      </p>
    </section>
  );
}

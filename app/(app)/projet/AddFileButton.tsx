"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ACCEPT, uploadFile } from "@/lib/upload";
import { Icon } from "@/components/ui";

/** Tuile « Ajouter un fichier » : le fichier est rangé dans le projet en cours. */
export default function AddFileButton() {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = [...list];
    setBusy(files.length);
    setMessage(null);
    const errors: string[] = [];
    for (const f of files) {
      try {
        const r = await uploadFile(f);
        if (r.status === "erreur") errors.push(`${f.name} : ${r.error}`);
      } catch (err) {
        errors.push(`${f.name} : ${err instanceof Error ? err.message : err}`);
      }
      setBusy((n) => n - 1);
    }
    setMessage(errors.length ? `⚠️ ${errors.join(" · ")}` : `✅ ${files.length} fichier(s) ajouté(s) au projet`);
    router.refresh();
  }

  return (
    <button onClick={() => input.current?.click()} disabled={busy > 0} className="card p-4 hover:bg-soft transition-colors flex flex-col gap-2 min-h-[112px] text-left">
      <span className="grid place-items-center size-11 rounded-xl" style={{ background: "#facc1522" }}>
        <Icon name={busy ? "progress_activity" : "upload_file"} filled className={`text-[24px] ${busy ? "animate-spin" : ""}`} style={{ color: "#facc15" }} />
      </span>
      <span className="text-[16px] font-bold leading-tight">{busy ? "Envoi en cours…" : "Ajouter un fichier"}</span>
      <span className="text-[13px] text-muted leading-snug">{message ?? "PDF, Word, Excel, image…"}</span>
      <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
    </button>
  );
}

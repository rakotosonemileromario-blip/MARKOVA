"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ACCEPT, uploadFile } from "@/lib/upload";
import { getCurrentProjectId } from "@/lib/project-client";

type FileRow = {
  id: string;
  name: string;
  kind: string;
  size_bytes: number;
  status: string;
  error: string | null;
  kpi_summary: string | null;
  storage_path: string;
  created_at: string;
};

const ICONS: Record<string, string> = { pdf: "📄", docx: "📝", tableur: "📊", texte: "📃", image: "🖼️", autre: "📦" };

function size(n: number) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / 1024 ** 2).toFixed(1)} Mo`;
}

export default function FilesPage() {
  const router = useRouter();
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    // Fichiers du projet actif (ou de l'espace général).
    const project = getCurrentProjectId();
    const q = createClient()
      .from("files")
      .select("id, name, kind, size_bytes, status, error, kpi_summary, storage_path, created_at")
      .order("created_at", { ascending: false });
    const { data } = await (project ? q.eq("project_id", project) : q.is("project_id", null));
    setFiles(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    const all = [...list];
    setUploading((n) => n + all.length);
    await Promise.all(
      all.map(async (f) => {
        try {
          const r = await uploadFile(f);
          setSelected((s) => [...s, r.id]);
        } catch (err) {
          alert(`${f.name} : ${err instanceof Error ? err.message : err}`);
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );
    load();
  }

  async function remove(f: FileRow) {
    if (!confirm(`Supprimer « ${f.name} » ?`)) return;
    const supabase = createClient();
    await supabase.storage.from("files").remove([f.storage_path]);
    await supabase.from("files").delete().eq("id", f.id);
    setSelected((s) => s.filter((x) => x !== f.id));
    load();
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-[24px] font-bold tracking-tight">Documents</h1>
        <p className="text-sm text-muted mt-1">
          PDF, DOCX, XLSX, CSV, TXT et images. Les statistiques publicitaires (CSV/XLSX) sont reconnues et leurs KPI calculés automatiquement.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFiles(e.dataTransfer.files);
          }}
          onClick={() => input.current?.click()}
          className={`mt-5 cursor-pointer rounded-2xl border-2 border-dashed px-4 py-8 text-center ${
            dragOver ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-accent"
          }`}
        >
          <div className="font-medium">＋ Ajouter des fichiers</div>
          <div className="text-sm text-muted mt-1">
            {uploading > 0 ? `Envoi et lecture de ${uploading} fichier(s)…` : "Glisser-déposer ou cliquer"}
          </div>
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        </div>

        {selected.length > 0 && (
          <div className="sticky top-0 z-10 mt-4 flex items-center justify-between gap-3 rounded-xl bg-accent-soft border border-accent/40 px-4 py-2.5">
            <span className="text-sm">{selected.length} fichier(s) sélectionné(s)</span>
            <button
              onClick={() => router.push(`/chat?files=${selected.join(",")}`)}
              className="rounded-lg bg-accent text-accent-ink px-3 py-1.5 text-sm font-medium"
            >
              Analyser ces fichiers →
            </button>
          </div>
        )}

        <div className="mt-4 divide-y divide-line rounded-2xl border border-line bg-panel">
          {files === null && <p className="p-4 text-sm text-muted">Chargement…</p>}
          {files?.length === 0 && <p className="p-4 text-sm text-muted">Aucun fichier pour l'instant.</p>}
          {files?.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={selected.includes(f.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, f.id] : s.filter((x) => x !== f.id)))}
                aria-label={`Sélectionner ${f.name}`}
              />
              <span aria-hidden>{ICONS[f.kind] ?? "📦"}</span>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium">{f.name}</div>
                <div className="text-xs text-muted">
                  {size(f.size_bytes)} · {new Date(f.created_at).toLocaleDateString("fr-FR")}
                  {f.kpi_summary && <span className="text-ok"> · KPI détectés</span>}
                  {f.status === "erreur" && <span className="text-danger"> · erreur : {f.error}</span>}
                  {f.status === "pret" && f.error && <span> · {f.error}</span>}
                </div>
              </div>
              <button onClick={() => remove(f)} className="text-muted hover:text-danger px-1" aria-label="Supprimer">
                🗑
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

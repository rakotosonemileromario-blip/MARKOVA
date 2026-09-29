"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ACCEPT, uploadFile } from "@/lib/upload";
import Markdown from "./Markdown";
import MemoryProposal, { splitProposals } from "./MemoryProposal";
import { NEW_CHAT_EVENT, REFRESH_EVENT } from "./Sidebar";
import { Icon } from "./ui";
import Orb from "./Orb";
import ActionCards, { type ActionItem } from "./ActionCards";
import { PROJECT_EVENT, setCurrentProjectId } from "@/lib/project-client";
import { speakSummary, stopSpeaking, useSpeechToText } from "@/lib/voice";

export type Source = { title: string; uri: string };
export type Msg = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  meta?: { model?: string; skills?: string[]; sources?: Source[]; notices?: string[]; tools?: string[]; actions?: ActionItem[]; error?: string };
};
type FileRef = { id: string; name: string };

const SUGGESTIONS = [
  { icon: "wb_sunny", title: "Briefing du jour", text: "Fais-moi mon briefing du jour : agenda, mails importants et tâches." },
  { icon: "query_stats", title: "Situation marketing", text: "Analyse ma situation marketing actuelle et dis-moi ce qu'on doit faire maintenant." },
  { icon: "campaign", title: "Campagnes Meta Ads", text: "Analyse ces statistiques Meta Ads et dis-moi si je dois modifier quelque chose." },
  { icon: "calendar_month", title: "Calendrier éditorial", text: "Prépare-moi le calendrier de contenu pour les deux prochaines semaines." },
];

const SKILL_LABELS: Record<string, string> = {
  "direction-marketing": "Direction",
  calendrier: "Calendrier",
  contenu: "Contenu",
  publicites: "Publicités",
  "media-buying": "Media Buying",
};

export default function Chat({
  conversationId: initialId,
  initialMessages = [],
  conversationFiles = [],
}: {
  conversationId?: string;
  initialMessages?: Msg[];
  conversationFiles?: FileRef[];
}) {
  const searchParams = useSearchParams();
  const [conversationId, setConversationId] = useState(initialId);
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [attached, setAttached] = useState<FileRef[]>(conversationFiles);
  const [pending, setPending] = useState<FileRef[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [webSearch, setWebSearch] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const autoSent = useRef(false);

  // Préférence recherche Web (confort local, sans incidence si le stockage est indisponible).
  useEffect(() => {
    try {
      setWebSearch(localStorage.getItem("markova:web") === "1");
    } catch {}
  }, []);
  function toggleWeb() {
    setWebSearch((v) => {
      try {
        localStorage.setItem("markova:web", v ? "0" : "1");
      } catch {}
      return !v;
    });
  }

  // Paramètres d'entrée : ?files=id1,id2 (depuis Fichiers), ?q=texte&send=1 (depuis l'accueil).
  useEffect(() => {
    const ids = searchParams.get("files")?.split(",").filter(Boolean);
    const q = searchParams.get("q");
    if (q && searchParams.get("send") === "1" && !autoSent.current) {
      autoSent.current = true;
      window.history.replaceState(null, "", "/chat");
      send(q, { voice: searchParams.get("voice") === "1" });
      return;
    }
    if (q) setInput(q);
    if (!ids?.length) return;
    createClient()
      .from("files")
      .select("id, name")
      .in("id", ids)
      .then(({ data }) => {
        if (!data?.length) return;
        setPending(data);
        if (!q)
          setInput(
            data.length > 1
              ? "Analyse ces fichiers, croise les informations et dis-moi ce qu'il faut faire."
              : "Analyse ce fichier et dis-moi ce qu'il faut en retenir.",
          );
      });
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // « Nouvelle analyse » depuis la navigation.
  useEffect(() => {
    const reset = () => {
      setConversationId(undefined);
      setMessages([]);
      setAttached([]);
      setPending([]);
      setInput("");
    };
    window.addEventListener(NEW_CHAT_EVENT, reset);
    return () => window.removeEventListener(NEW_CHAT_EVENT, reset);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = [...list];
    setUploading((n) => n + files.length);
    await Promise.all(
      files.map(async (f) => {
        try {
          const r = await uploadFile(f);
          setPending((p) => [...p, { id: r.id, name: r.name }]);
          if (r.status === "erreur") alert(`${f.name} : extraction impossible (${r.error}).`);
        } catch (err) {
          alert(`${f.name} : ${err instanceof Error ? err.message : err}`);
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );
  }

  function updateLast(fn: (m: Msg) => Msg) {
    setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);
  }

  // Dictée : le texte s'affiche en direct puis part tout seul ; la réponse sera lue à voix haute.
  const mic = useSpeechToText((t) => send(t, { voice: true }));
  const listening = mic.state !== "idle";

  async function send(text = input, opts: { voice?: boolean } = {}) {
    const message = text.trim();
    if (!message || busy || uploading) return;
    stopSpeaking();
    let full = "";
    const fileIds = pending.map((f) => f.id);
    setBusy(true);
    setInput("");
    setAttached((a) => [...a, ...pending.filter((p) => !a.some((x) => x.id === p.id))]);
    setPending([]);
    setMessages((ms) => [...ms, { role: "user", content: message }, { role: "assistant", content: "", meta: {} }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message, fileIds, webSearch, voice: Boolean(opts.voice) }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Erreur ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.t === "start") {
            if (!conversationId) {
              setConversationId(ev.conversationId);
              window.history.replaceState(null, "", `/c/${ev.conversationId}`);
              window.dispatchEvent(new Event(REFRESH_EVENT));
            }
            updateLast((m) => ({ ...m, meta: { ...m.meta, skills: ev.skills } }));
          } else if (ev.t === "tool") {
            updateLast((m) => ({ ...m, meta: { ...m.meta, tools: [...(m.meta?.tools ?? []), ev.v] } }));
          } else if (ev.t === "projects") {
            // Projet créé / lié / activé par l'agent : on met à jour le menu Projet.
            if (ev.v) setCurrentProjectId(ev.v);
            window.dispatchEvent(new Event(PROJECT_EVENT));
          } else if (ev.t === "action") {
            updateLast((m) => ({ ...m, meta: { ...m.meta, actions: [...(m.meta?.actions ?? []), ev.v] } }));
          } else if (ev.t === "text") {
            full += ev.v;
            updateLast((m) => ({ ...m, content: m.content + ev.v }));
          } else if (ev.t === "model") {
            updateLast((m) => ({ ...m, meta: { ...m.meta, model: ev.v } }));
          } else if (ev.t === "notice") {
            updateLast((m) => ({ ...m, meta: { ...m.meta, notices: [...(m.meta?.notices ?? []), ev.v] } }));
          } else if (ev.t === "sources") {
            updateLast((m) => ({ ...m, meta: { ...m.meta, sources: ev.v } }));
          } else if (ev.t === "error") {
            updateLast((m) => ({ ...m, meta: { ...m.meta, error: ev.v } }));
          }
        }
      }
      // Question vocale : on lit uniquement un résumé (bloc vocal, sinon résumé demandé au serveur).
      if (opts.voice && full) {
        const { text: written, vocal } = splitProposals(full);
        speakSummary(written, vocal);
      }
    } catch (err) {
      updateLast((m) => ({ ...m, meta: { ...m.meta, error: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setBusy(false);
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6">
          {empty ? (
            <div className="pt-[3vh]">
              <div className="flex flex-col items-center text-center reveal">
                <Orb size={84} />
                <div className="mt-6 flex items-center gap-2 label-caps text-cyan">
                  <span className="size-1.5 rounded-full bg-cyan animate-pulse" /> Directeur marketing IA · en ligne
                </div>
                <h1 className="mt-2 text-[28px] font-bold tracking-tight leading-tight text-holo">Que veux-tu analyser ?</h1>
                <p className="text-muted mt-1.5 text-[14px] max-w-md">
                  Parle, écris, joins des fichiers (PDF, DOCX, XLSX, CSV, images) ou prends une photo.
                </p>
              </div>
              <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s.title}
                    onClick={() => (s.icon === "wb_sunny" ? send(s.text) : setInput(s.text))}
                    style={{ ["--i" as string]: i + 2 }}
                    className="card text-left p-3.5 hover:bg-soft transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="grid place-items-center size-8 rounded-lg bg-accent-soft text-accent-text">
                        <Icon name={s.icon} className="text-[18px]" />
                      </span>
                      <span className="font-semibold text-[14px]">{s.title}</span>
                    </div>
                    <p className="mt-2 text-[13px] text-muted leading-snug">{s.text}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((m, i) => (
                <Message key={m.id ?? i} msg={m} streaming={busy && i === messages.length - 1} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Zone de saisie ─── */}
      <div className="shrink-0 px-3 pb-3 pt-2 md:px-4">
        <div className={`mx-auto max-w-3xl rounded-2xl border border-line glass p-2.5 holo ${busy || listening ? "is-active" : ""}`}>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 px-0.5 text-[11px]">
            <button
              onClick={toggleWeb}
              className={`shrink-0 inline-flex items-center gap-1 rounded-md border px-2 h-6 font-medium ${
                webSearch ? "border-cyan/50 bg-cyan-soft text-cyan" : "border-line text-muted"
              }`}
            >
              <Icon name="travel_explore" className="text-[14px]" /> Web {webSearch ? "activé" : "désactivé"}
            </button>
            <button
              onClick={() => setPickerOpen(true)}
              className="shrink-0 inline-flex items-center gap-1 rounded-md border border-line px-2 h-6 font-medium text-muted hover:text-ink"
            >
              <Icon name="folder_open" className="text-[14px]" /> Mes fichiers
            </button>
            {attached.length > 0 && (
              <span className="shrink-0 inline-flex items-center gap-1 text-muted truncate max-w-[50%]" title={attached.map((f) => f.name).join(", ")}>
                <Icon name="attach_file" className="text-[14px]" />
                {attached.length} fichier{attached.length > 1 ? "s" : ""} dans le contexte
              </span>
            )}
          </div>

          {mic.error && <p className="mb-2 px-1 text-[12px] text-danger">{mic.error}</p>}
          {(pending.length > 0 || uploading > 0) && (
            <div className="mb-2 flex flex-wrap gap-1.5 px-0.5">
              {pending.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1 rounded-md bg-soft border border-line px-2 h-7 text-[12px]">
                  <Icon name="description" className="text-[14px] text-accent-text" />
                  <span className="max-w-[180px] truncate">{f.name}</span>
                  <button onClick={() => setPending((p) => p.filter((x) => x.id !== f.id))} aria-label="Retirer" className="text-muted hover:text-ink">
                    <Icon name="close" className="text-[14px]" />
                  </button>
                </span>
              ))}
              {uploading > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-soft px-2 h-7 text-[12px] text-muted animate-pulse">
                  <Icon name="progress_activity" className="text-[14px]" /> Lecture…
                </span>
              )}
            </div>
          )}

          {listening ? (
            /* ─── Écoute en cours : on parle aussi longtemps qu'on veut, puis Stop ─── */
            <div className="rounded-xl border border-danger/50 bg-soft p-3 reveal">
              <div className="flex items-center gap-3 label-caps text-danger">
                <Orb size={26} state="listening" />
                <span className="flex-1">{mic.state === "transcribing" ? "Je vérifie ce que tu as dit…" : "Je t'écoute — appuie sur Stop quand tu as fini"}</span>
                <span className="eq flex items-center h-5 text-danger" aria-hidden>
                  <span /><span /><span /><span /><span />
                </span>
              </div>
              <p className="mt-2 min-h-[44px] max-h-40 overflow-y-auto text-[15px] leading-relaxed">
                {mic.transcript || <span className="text-muted">Parle, les pauses ne coupent pas l'écoute…</span>}
              </p>
              <div className="mt-3 flex gap-2">
                <button onClick={mic.cancel} className="rounded-lg border border-line h-11 px-4 text-[14px] font-semibold text-muted hover:text-ink">
                  Annuler
                </button>
                <button
                  onClick={mic.stop}
                  disabled={mic.state === "transcribing"}
                  className="flex-1 rounded-lg bg-danger text-white h-11 text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  <Icon name="stop" filled className="text-[20px]" /> Stop · Envoyer
                </button>
              </div>
            </div>
          ) : (
          <div className="flex items-end gap-1.5">
            <button
              onClick={() => cameraInput.current?.click()}
              className="shrink-0 grid place-items-center size-10 rounded-xl bg-soft border border-line text-muted hover:text-ink"
              title="Prendre une photo"
              aria-label="Prendre une photo"
            >
              <Icon name="photo_camera" className="text-[20px]" />
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              className="shrink-0 grid place-items-center size-10 rounded-xl bg-soft border border-line text-muted hover:text-ink"
              title="Joindre des fichiers"
              aria-label="Joindre des fichiers"
            >
              <Icon name="attach_file" className="text-[20px]" />
            </button>
            <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
            <textarea
              ref={textarea}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Demande à MARKOVA…"
              className="flex-1 min-w-0 min-h-10 resize-none rounded-xl bg-soft border border-[var(--hairline)] px-3 py-2.5 text-[15px] outline-none focus:border-accent placeholder:text-muted"
            />
            {/* Micro : toujours visible */}
            <button
              onClick={mic.start}
              disabled={busy || uploading > 0}
              aria-label="Parler à MARKOVA"
              title="Parler"
              className="shrink-0 grid place-items-center size-10 rounded-xl bg-soft border border-accent/60 text-accent-text hover:bg-accent-soft disabled:opacity-40 pulse-glow"
            >
              <Icon name="mic" filled className="text-[21px]" />
            </button>
            <button
              onClick={() => send()}
              disabled={busy || uploading > 0 || !input.trim()}
              aria-label="Envoyer"
              className="shrink-0 grid place-items-center size-10 rounded-xl bg-accent-strong text-white disabled:opacity-35 glow"
            >
              <Icon name={busy ? "more_horiz" : "arrow_upward"} className="text-[20px]" />
            </button>
          </div>
          )}
        </div>
      </div>

      {pickerOpen && (
        <FilePicker
          exclude={[...attached, ...pending].map((f) => f.id)}
          onClose={() => setPickerOpen(false)}
          onPick={(files) => {
            setPending((p) => [...p, ...files]);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Message({ msg, streaming }: { msg: Msg; streaming: boolean }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end reveal">
        <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-accent-strong/30 to-soft border border-accent/30 px-4 py-3 text-[15px] shadow-[0_8px_30px_-12px_rgba(79,70,229,0.5)]">
          {msg.content}
        </div>
      </div>
    );
  }
  const { text, proposals, vocal } = splitProposals(msg.content);
  const meta = msg.meta ?? {};
  return (
    <div className="reveal">
      <div className="flex items-center gap-2.5 mb-2">
        <Orb size={22} state={streaming ? "busy" : "idle"} />
        <span className="label-caps text-accent-text">MARKOVA · Synthèse</span>
        {streaming && <span className="text-[11px] text-cyan text-holo font-semibold">analyse en cours</span>}
      </div>

      <div className={`card p-4 ${streaming ? "scan is-active" : ""}`}>
        {meta.notices?.map((n, i) => (
          <p key={i} className="mb-2 flex items-start gap-1.5 text-[12px] text-muted">
            <Icon name="info" className="text-[15px] mt-px" /> {n}
          </p>
        ))}
        {meta.tools && meta.tools.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {meta.tools.map((t, i) => (
              <span
                key={i}
                className="reveal inline-flex items-center gap-1.5 rounded-md bg-cyan-soft border border-cyan/20 text-cyan px-2 h-6 text-[11px] font-medium"
                style={{ ["--i" as string]: i }}
              >
                <span className={`size-1.5 rounded-full bg-cyan ${streaming ? "animate-ping" : ""}`} />
                {t}
              </span>
            ))}
          </div>
        )}
        {text ? (
          <Markdown>{text}</Markdown>
        ) : (
          streaming &&
          !meta.error && (
            <div className="space-y-2 py-1">
              <p className="text-[14px] font-semibold text-holo">MARKOVA analyse…</p>
              <div className="skeleton h-3 w-11/12 rounded" />
              <div className="skeleton h-3 w-9/12 rounded" />
              <div className="skeleton h-3 w-10/12 rounded" />
            </div>
          )
        )}
        {meta.error && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            <Icon name="error" className="text-[16px] mt-px" /> {meta.error}
          </p>
        )}
        {meta.actions && meta.actions.length > 0 && <ActionCards actions={meta.actions} />}
        {!streaming && proposals.map((p, i) => <MemoryProposal key={i} proposal={p} />)}
        {meta.sources && meta.sources.length > 0 && (
          <div className="mt-4 border-t border-line pt-3 text-[12px]">
            <div className="label-caps text-muted mb-1.5">Sources Web</div>
            <ol className="list-decimal pl-5 space-y-0.5">
              {meta.sources.map((s) => (
                <li key={s.uri}>
                  <a href={s.uri} target="_blank" rel="noreferrer" className="text-accent-text underline underline-offset-2">
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {text && !streaming && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <button
            onClick={() => speakSummary(text, vocal)}
            className="inline-flex items-center gap-1 rounded-md bg-soft border border-line px-2 h-6 font-medium text-ink hover:border-accent"
            title="Lire un résumé à voix haute"
          >
            <Icon name="volume_up" className="text-[14px]" /> Écouter le résumé
          </button>
          <button onClick={stopSpeaking} className="inline-flex items-center rounded-md border border-line px-1.5 h-6 hover:text-ink" aria-label="Arrêter la lecture">
            <Icon name="stop" className="text-[14px]" />
          </button>
          {meta.skills?.map((s) => (
            <span key={s} className="rounded-md border border-line px-1.5 h-5 inline-flex items-center">
              {SKILL_LABELS[s] ?? s}
            </span>
          ))}
          {meta.model && <span className="px-1">{meta.model}</span>}
        </div>
      )}
    </div>
  );
}

function FilePicker({
  exclude,
  onClose,
  onPick,
}: {
  exclude: string[];
  onClose: () => void;
  onPick: (files: FileRef[]) => void;
}) {
  const [files, setFiles] = useState<(FileRef & { kind: string; created_at: string })[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    createClient()
      .from("files")
      .select("id, name, kind, created_at")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setFiles((data ?? []).filter((f) => !exclude.includes(f.id))));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl glass border border-[var(--hairline)] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Joindre des fichiers existants</h2>
          <button onClick={onClose} className="text-muted" aria-label="Fermer">
            <Icon name="close" />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto space-y-0.5">
          {files === null && <p className="text-sm text-muted">Chargement…</p>}
          {files?.length === 0 && <p className="text-sm text-muted">Aucun autre fichier.</p>}
          {files?.map((f) => (
            <label key={f.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-soft text-sm cursor-pointer">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={selected.includes(f.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, f.id] : s.filter((x) => x !== f.id)))}
              />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted">{f.kind}</span>
            </label>
          ))}
        </div>
        <button
          disabled={!selected.length}
          onClick={() => onPick(files!.filter((f) => selected.includes(f.id)).map(({ id, name }) => ({ id, name })))}
          className="mt-3 w-full rounded-lg bg-accent-strong text-white h-11 font-semibold disabled:opacity-40"
        >
          Joindre {selected.length || ""}
        </button>
      </div>
    </div>
  );
}

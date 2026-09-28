import { lookup } from "dns/promises";
import { isIP } from "net";
import { hasWebSearchProvider, searchWeb } from "./websearch";
import type { ToolSet } from "./llm";

// Outils Web toujours disponibles pour l'agent : il lit un lien ou cherche de lui-même,
// sans que l'utilisateur ait à activer quoi que ce soit.

const MAX_PAGE_CHARS = 40_000;

/** Refuse les adresses internes (localhost, réseau privé) : le serveur ne doit lire que le Web public. */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("adresse invalide");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("seuls les liens http(s) sont lisibles");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("adresse interne refusée");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  for (const ip of addresses) {
    if (
      /^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(ip) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
      /^(::1|fc|fd|fe80)/i.test(ip) ||
      ip === "::"
    ) {
      throw new Error("adresse interne refusée");
    }
  }
  return url;
}

function htmlToText(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i)?.[1] ??
    "";
  const body = html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|br|tr|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => "\n" + "#".repeat(Number(n)) + " ")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    // lignes vides ou puces de menu sans texte
    .filter((l) => l.replace(/^[-#\s]+/, "").length > 1)
    .join("\n");
  const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  return { title: decode(title), description: decode(description), body };
}

export async function readWebPage(raw: string): Promise<string> {
  const url = await assertPublicUrl(raw);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MARKOVA/1.0)", Accept: "text/html,application/xhtml+xml,text/plain;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/|html|xml|json/.test(type)) return `Le lien renvoie un fichier (${type}) : télécharge-le et joins-le dans MARKOVA pour qu'il soit analysé.`;
  const raw_text = (await res.text()).slice(0, 2_000_000);
  const { title, description, body } = /html/.test(type) ? htmlToText(raw_text) : { title: "", description: "", body: raw_text };
  const text = body.length > MAX_PAGE_CHARS ? `${body.slice(0, MAX_PAGE_CHARS)}\n…[page tronquée]` : body;
  if (text.length < 200 && hasWebSearchProvider()) {
    // Site construit en JavaScript : peu de texte lisible. On complète par une recherche sur le domaine.
    const r = await searchWeb(`site:${url.hostname} ${title}`).catch(() => null);
    const extra = r?.results.map((x) => `- ${x.title} (${x.url}) : ${x.content.slice(0, 400)}`).join("\n");
    return [`Page ${url.href}`, title && `Titre : ${title}`, description && `Description : ${description}`, text, extra && `Résultats de recherche sur le site :\n${extra}`]
      .filter(Boolean)
      .join("\n\n");
  }
  return [`Page ${url.href}`, title && `Titre : ${title}`, description && `Description : ${description}`, text].filter(Boolean).join("\n\n");
}

export const WEB_TOOLS: ToolSet["defs"] = [
  {
    name: "web_lire_page",
    label: "🌐 Lecture de la page",
    description: "Lit le contenu texte d'une page Web publique à partir de son URL (site d'un client, concurrent, landing page, article). À utiliser dès qu'un lien est fourni.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
];

if (hasWebSearchProvider()) {
  WEB_TOOLS.push({
    name: "web_rechercher",
    label: "🔎 Recherche Web",
    description: "Recherche sur Internet (actualités, tendances, concurrents, règles des plateformes, données de marché). Renvoie titres, liens et extraits à citer.",
    parameters: { type: "object", properties: { requete: { type: "string" } }, required: ["requete"] },
  });
}

/** Exécute un outil Web ; `onSources` reçoit les liens consultés (affichés sous la réponse). */
export async function runWebTool(
  name: string,
  args: Record<string, unknown>,
  onSources: (s: { title: string; uri: string }[]) => void,
): Promise<string | null> {
  if (name === "web_lire_page") {
    const text = await readWebPage(String(args.url ?? ""));
    const title = text.match(/^Titre : (.*)$/m)?.[1];
    onSources([{ uri: String(args.url), title: title || String(args.url) }]);
    return text;
  }
  if (name === "web_rechercher") {
    const r = await searchWeb(String(args.requete ?? ""));
    onSources(r.results.map((x) => ({ title: x.title, uri: x.url })));
    return (
      (r.answer ? `Synthèse : ${r.answer}\n\n` : "") +
      r.results.map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.content.slice(0, 1200)}`).join("\n\n")
    );
  }
  return null;
}

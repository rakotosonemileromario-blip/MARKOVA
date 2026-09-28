import type { Source } from "./llm";

export type WebResults = { answer?: string; results: { title: string; url: string; content: string }[] };

export const hasWebSearchProvider = () => Boolean(process.env.TAVILY_API_KEY);

/** Recherche Web via Tavily (offre gratuite mensuelle). Fonctionne quel que soit le modèle IA. */
export async function searchWeb(query: string): Promise<WebResults> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query: query.slice(0, 400), max_results: 6, search_depth: "basic", include_answer: "basic" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Recherche Web : HTTP ${res.status}`);
  const json = (await res.json()) as WebResults;
  return { answer: json.answer, results: (json.results ?? []).map(({ title, url, content }) => ({ title, url, content })) };
}

export function webResultsToPrompt(r: WebResults) {
  const list = r.results
    .map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.content.slice(0, 1500)}`)
    .join("\n\n");
  return (
    `\n---\n# RÉSULTATS DE RECHERCHE WEB (🌐)\n` +
    `Utilise-les pour les informations actuelles, cite-les sous la forme [n], et signale si elles ne suffisent pas.\n\n` +
    (r.answer ? `Synthèse du moteur : ${r.answer}\n\n` : "") +
    list
  );
}

export const webResultsToSources = (r: WebResults): Source[] => r.results.map((x) => ({ title: x.title, uri: x.url }));

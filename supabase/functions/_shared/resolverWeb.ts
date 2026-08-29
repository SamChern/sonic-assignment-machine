// Step 13 — open-web metadata lookup for the Resolver.
//
// Meaning about sound is freely referenceable; recordings are not. This module
// only ever fetches text metadata (encyclopaedic summaries, catalog
// descriptions) from an explicit host allow-list, and never audio bytes or
// stream URLs. Licensed catalogs (Freesound, Jamendo) are reachable for
// descriptions only, and only when their public endpoints answer without a key.

const ALLOWED_HOSTS = new Set([
  "en.wikipedia.org",
  "api.duckduckgo.com",
]);

export interface WebSnippet {
  source: string;
  title: string;
  text: string;
  url?: string;
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const host = new URL(url).host;
    if (!ALLOWED_HOSTS.has(host)) return null;
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "SonicSIM-Resolver/1.0" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("resolver web fetch failed", url, e);
    return null;
  }
}

async function wikipedia(query: string): Promise<WebSnippet[]> {
  const search = await getJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=2&format=json&origin=*&srsearch=${
      encodeURIComponent(query)
    }`,
  ) as { query?: { search?: { title: string; snippet?: string }[] } } | null;
  const hits = search?.query?.search ?? [];
  const out: WebSnippet[] = [];
  for (const hit of hits.slice(0, 2)) {
    const summary = await getJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`,
    ) as { extract?: string; content_urls?: { desktop?: { page?: string } } } | null;
    const text = summary?.extract ?? (hit.snippet ?? "").replace(/<[^>]+>/g, "");
    if (!text) continue;
    out.push({
      source: "wikipedia",
      title: hit.title,
      text: text.slice(0, 1200),
      url: summary?.content_urls?.desktop?.page,
    });
  }
  return out;
}

async function instantAnswer(query: string): Promise<WebSnippet[]> {
  const data = await getJson(
    `https://api.duckduckgo.com/?format=json&no_html=1&no_redirect=1&q=${encodeURIComponent(query)}`,
  ) as {
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: { Text?: string }[];
  } | null;
  if (!data) return [];
  const out: WebSnippet[] = [];
  if (data.AbstractText) {
    out.push({
      source: "duckduckgo",
      title: data.Heading ?? query,
      text: data.AbstractText.slice(0, 1200),
      url: data.AbstractURL,
    });
  }
  const related = (data.RelatedTopics ?? []).map((t) => t.Text).filter(Boolean).slice(0, 3);
  if (related.length) {
    out.push({
      source: "duckduckgo:related",
      title: `${query} — related`,
      text: related.join(" · ").slice(0, 800),
    });
  }
  return out;
}

/**
 * `search_web` tool: open-web metadata about a symbol. Returns [] when nothing
 * is reachable — the caller then resolves from the symbol string alone with a
 * lower confidence.
 */
export async function searchWeb(query: string, hint = ""): Promise<WebSnippet[]> {
  const q = hint ? `${query} ${hint}` : query;
  const [wiki, ia] = await Promise.all([wikipedia(q), instantAnswer(q)]);
  return [...wiki, ...ia].slice(0, 5);
}

/** Compact snippet block for the model prompt. */
export function snippetBlock(snippets: WebSnippet[]): string {
  if (!snippets.length) return "(no open-web metadata found)";
  return snippets
    .map((s, i) => `[${i + 1}] (${s.source}) ${s.title}: ${s.text}`)
    .join("\n");
}

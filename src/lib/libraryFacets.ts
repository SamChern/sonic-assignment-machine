// Library consolidation: derive a handful of honest meta tags per source so a
// library of thousands collapses into a few readable groups.
import type { AudioSource } from "@/hooks/useAudioSources";

export type Provider = "spotify" | "apple" | "upload" | "intuizi" | "ctv" | "other";
/** Audio the user can hear vs. delivered signal/meta data about people. */
export type Kind = "audio" | "user_data";
export type Content = "music" | "spoken_word" | "mixed";

export interface SourceFacets {
  provider: Provider;
  providerLabel: string;
  kind: Kind;
  content: Content;
  fileType: string;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  spotify: "Spotify",
  apple: "Apple Music",
  upload: "Uploads",
  intuizi: "Intuizi signals",
  ctv: "CTV & web",
  other: "Other sources",
};

export const providerLabel = (p: Provider) => PROVIDER_LABELS[p];

const SPOKEN_HINTS = [
  "podcast", "interview", "voice", "vo ", "speech", "talk", "episode",
  "audiobook", "narration", "sermon", "lecture", "news", "commentary",
];

const provider = (s: AudioSource): Provider => {
  const t = (s.source_type ?? "").toLowerCase();
  if (t.includes("spotify")) return "spotify";
  if (t.includes("apple")) return "apple";
  if (t.includes("intuizi")) return "intuizi";
  if (t.includes("ctv") || t.includes("web")) return "ctv";
  if (t.includes("upload") || t.includes("file") || s.file_url) return "upload";
  return "other";
};

const kindOf = (p: Provider): Kind => (p === "intuizi" || p === "ctv" ? "user_data" : "audio");

const fileTypeOf = (s: AudioSource, p: Provider): string => {
  if (s.file_url) {
    const ext = s.file_url.split("?")[0].split(".").pop();
    if (ext && ext.length <= 5) return ext.toLowerCase();
  }
  if (p === "spotify" || p === "apple") return "stream";
  if (p === "intuizi" || p === "ctv") return "signal";
  return "other";
};

const contentOf = (s: AudioSource, p: Provider): Content => {
  const name = `${s.name ?? ""} ${s.album_name ?? ""}`.toLowerCase();
  if (SPOKEN_HINTS.some((h) => name.includes(h))) return "spoken_word";
  if (p === "ctv" || p === "intuizi") return "mixed";
  if (s.artists?.length || p === "spotify" || p === "apple") return "music";
  return "mixed";
};

export function facetsFor(source: AudioSource): SourceFacets {
  const p = provider(source);
  return {
    provider: p,
    providerLabel: PROVIDER_LABELS[p],
    kind: kindOf(p),
    content: contentOf(source, p),
    fileType: fileTypeOf(source, p),
  };
}

export interface FacetFilter {
  kind: Kind | "all";
  content: Content | "all";
  provider: Provider | "all";
  fileType: string | "all";
}

export const EMPTY_FILTER: FacetFilter = {
  kind: "all",
  content: "all",
  provider: "all",
  fileType: "all",
};

export const matchesFilter = (f: SourceFacets, filter: FacetFilter) =>
  (filter.kind === "all" || f.kind === filter.kind) &&
  (filter.content === "all" || f.content === filter.content) &&
  (filter.provider === "all" || f.provider === filter.provider) &&
  (filter.fileType === "all" || f.fileType === filter.fileType);

export const CONTENT_LABELS: Record<Content, string> = {
  music: "Music",
  spoken_word: "Spoken word",
  mixed: "Mixed",
};

export const KIND_LABELS: Record<Kind, string> = {
  audio: "Audio",
  user_data: "User data",
};

export interface LibraryGroup {
  provider: Provider;
  label: string;
  sources: AudioSource[];
}

/** Filter, then group the remaining sources by provider (largest group first). */
export function groupLibrary(
  sources: AudioSource[],
  filter: FacetFilter,
): { groups: LibraryGroup[]; counts: Record<string, number>; total: number } {
  const counts: Record<string, number> = {};
  const bump = (k: string) => {
    counts[k] = (counts[k] ?? 0) + 1;
  };
  const byProvider = new Map<Provider, AudioSource[]>();

  for (const s of sources) {
    const f = facetsFor(s);
    // Counts describe the whole library so chips never read as zero-only.
    bump(`provider:${f.provider}`);
    bump(`kind:${f.kind}`);
    bump(`content:${f.content}`);
    bump(`fileType:${f.fileType}`);
    if (!matchesFilter(f, filter)) continue;
    const list = byProvider.get(f.provider) ?? [];
    list.push(s);
    byProvider.set(f.provider, list);
  }

  const groups = [...byProvider.entries()]
    .map(([p, list]) => ({ provider: p, label: PROVIDER_LABELS[p], sources: list }))
    .sort((a, b) => b.sources.length - a.sources.length);

  return { groups, counts, total: groups.reduce((n, g) => n + g.sources.length, 0) };
}

import { useMemo, useState } from "react";
import { FileAudio, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { AudioSource } from "@/hooks/useAudioSources";
import type { CreatorAnalysisRow } from "@/hooks/useCreatorSpace";

interface Props {
  sources: AudioSource[];
  analyses: CreatorAnalysisRow[];
  loading: boolean;
}

/** The creator's own sounds, with whether each one has been read yet. */
const CreatorLibraryPanel = ({ sources, analyses, loading }: Props) => {
  const [query, setQuery] = useState("");

  const analysedIds = useMemo(
    () => new Set(analyses.map((a) => a.audio_source_id).filter(Boolean) as string[]),
    [analyses],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.album_name ?? "").toLowerCase().includes(q) ||
        (s.artists ?? []).some((a) => a.toLowerCase().includes(q)),
    );
  }, [sources, query]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your sounds"
          aria-label="Search your sounds"
          className="h-9 pl-9"
        />
      </div>

      {loading ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Loading your sounds…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {sources.length === 0
            ? "Nothing here yet. Upload a track or add one from a service to start."
            : "No sounds match that search."}
        </Card>
      ) : (
        <Card className="divide-y divide-border/50">
          {filtered.slice(0, 100).map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <FileAudio className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{s.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {(s.artists ?? []).join(", ") || s.album_name || s.source_type}
                </p>
              </div>
              <Badge
                variant={analysedIds.has(s.id) ? "secondary" : "outline"}
                className="text-[10px]"
              >
                {analysedIds.has(s.id) ? "read" : "not read yet"}
              </Badge>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
};

export default CreatorLibraryPanel;

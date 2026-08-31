import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import {
  CONTENT_LABELS,
  EMPTY_FILTER,
  KIND_LABELS,
  providerLabel,
  type Content,
  type FacetFilter,
  type Kind,
  type Provider,
} from "@/lib/libraryFacets";

interface Props {
  filter: FacetFilter;
  counts: Record<string, number>;
  onChange: (next: FacetFilter) => void;
}

const Chip = ({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
      active
        ? "border-primary bg-primary/15 text-foreground"
        : "border-border/60 bg-card/60 text-muted-foreground hover:text-foreground"
    }`}
  >
    {label}
    {count !== undefined && <span className="ml-1 opacity-60">{count}</span>}
  </button>
);

/** Compact chip bar that narrows a large library by a few meta tags. */
export function LibraryFacetBar({ filter, counts, onChange }: Props) {
  const kinds = (Object.keys(KIND_LABELS) as Kind[]).filter((k) => counts[`kind:${k}`]);
  const contents = (Object.keys(CONTENT_LABELS) as Content[]).filter(
    (c) => counts[`content:${c}`],
  );
  const providers = (
    ["spotify", "apple", "upload", "intuizi", "ctv", "other"] as Provider[]
  ).filter((p) => counts[`provider:${p}`]);
  const fileTypes = Object.keys(counts)
    .filter((k) => k.startsWith("fileType:"))
    .map((k) => k.slice("fileType:".length))
    .sort((a, b) => counts[`fileType:${b}`] - counts[`fileType:${a}`])
    .slice(0, 6);

  const dirty =
    filter.kind !== "all" ||
    filter.content !== "all" ||
    filter.provider !== "all" ||
    filter.fileType !== "all";

  const toggle = <K extends keyof FacetFilter>(key: K, value: FacetFilter[K]) =>
    onChange({ ...filter, [key]: filter[key] === value ? "all" : value });

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-card/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
          Filter library
        </Badge>
        {dirty && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange(EMPTY_FILTER)}>
            <X className="mr-1 h-3 w-3" /> Clear
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <Chip
            key={k}
            label={KIND_LABELS[k]}
            count={counts[`kind:${k}`]}
            active={filter.kind === k}
            onClick={() => toggle("kind", k)}
          />
        ))}
        {contents.map((c) => (
          <Chip
            key={c}
            label={CONTENT_LABELS[c]}
            count={counts[`content:${c}`]}
            active={filter.content === c}
            onClick={() => toggle("content", c)}
          />
        ))}
        {providers.map((p) => (
          <Chip
            key={p}
            label={providerLabel(p)}
            count={counts[`provider:${p}`]}
            active={filter.provider === p}
            onClick={() => toggle("provider", p)}
          />
        ))}
        {fileTypes.map((t) => (
          <Chip
            key={t}
            label={`.${t}`}
            count={counts[`fileType:${t}`]}
            active={filter.fileType === t}
            onClick={() => toggle("fileType", t)}
          />
        ))}
      </div>
    </div>
  );
}

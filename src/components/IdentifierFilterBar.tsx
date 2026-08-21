import { useMemo, useState, type ReactNode } from "react";
import { Check, Filter, Search, Tags, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  EMPTY_IDENTIFIER_FILTER,
  identifierFilterCount,
  isFilterActive,
  tagLabel,
  type IdentifierFilterState,
  type TagOption,
} from "@/lib/identifierFilters";
import { cn } from "@/lib/utils";

export interface FilterSegment {
  value: string;
  label: string;
  count?: number;
}

interface IdentifierFilterBarProps {
  value: IdentifierFilterState;
  onChange: (next: IdentifierFilterState) => void;
  /** Tag codes available in the current dataset, with occurrence counts. */
  tags: TagOption[];
  /** Optional extra segmented control (e.g. pipeline stage) rendered inline. */
  segments?: FilterSegment[];
  segmentValue?: string;
  onSegmentChange?: (value: string) => void;
  resultCount: number;
  totalCount: number;
  /** Noun used in the result summary, e.g. "identifier". */
  noun?: string;
  placeholder?: string;
  className?: string;
  /** Right-aligned slot for page-specific controls. */
  trailing?: ReactNode;
  /** Basis chips only make sense where vectors are derived (cohort views). */
  showBasis?: boolean;
}

const BASIS_OPTIONS: { value: IdentifierFilterState["basis"]; label: string }[] = [
  { value: "any", label: "Any basis" },
  { value: "scored", label: "Scored" },
  { value: "inherited", label: "Inherited" },
  { value: "facet-only", label: "Facet only" },
];

/**
 * Compact, scale-safe filter bar for identifier-level views.
 *
 * Everything collapses into one row: search, a searchable tag popover (so tens
 * of thousands of identifiers never render a tag list inline), optional stage
 * segments, and removable chips for whatever is active.
 */
export function IdentifierFilterBar({
  value,
  onChange,
  tags,
  segments,
  segmentValue,
  onSegmentChange,
  resultCount,
  totalCount,
  noun = "identifier",
  placeholder = "Search identifiers, tags or facets…",
  className,
  trailing,
  showBasis = true,
}: IdentifierFilterBarProps) {
  const [tagOpen, setTagOpen] = useState(false);
  const active = isFilterActive(value);
  const count = identifierFilterCount(value);

  const selectedTags = useMemo(
    () => value.tags.map(code => tags.find(t => t.code === code) ?? { code, label: tagLabel(code), count: 0 }),
    [value.tags, tags],
  );

  const toggleTag = (code: string) => {
    onChange({
      ...value,
      tags: value.tags.includes(code) ? value.tags.filter(c => c !== code) : [...value.tags, code],
    });
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={value.text}
            onChange={e => onChange({ ...value, text: e.target.value })}
            placeholder={placeholder}
            className="h-9 pl-8 bg-card/60 backdrop-blur-sm"
            aria-label="Search identifiers"
          />
        </div>

        <Popover open={tagOpen} onOpenChange={setTagOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-2">
              <Tags className="h-4 w-4" />
              Tags
              {value.tags.length > 0 && (
                <Badge variant="secondary">{value.tags.length}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0 bg-popover" align="start">
            <Command>
              <CommandInput placeholder="Search taxonomy tags…" />
              <CommandList>
                <CommandEmpty>No tags in this dataset.</CommandEmpty>
                <CommandGroup>
                  {tags.slice(0, 300).map(t => (
                    <CommandItem
                      key={t.code}
                      value={`${t.label} ${t.code}`}
                      onSelect={() => toggleTag(t.code)}
                      className="cursor-pointer gap-2"
                    >
                      <span className="flex-1 truncate">{t.label}</span>
                      <span className="text-xs text-muted-foreground">{t.count}</span>
                      {value.tags.includes(t.code) && <Check className="h-4 w-4 text-primary" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {showBasis && (
        <div className="flex items-center gap-1 rounded-md border border-border/60 bg-card/60 p-0.5">
          {BASIS_OPTIONS.map(opt => (
            <Button
              key={opt.value}
              size="sm"
              variant={value.basis === opt.value ? "default" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => onChange({ ...value, basis: opt.value })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        )}

        {segments && segments.length > 0 && (
          <div className="flex items-center gap-1 rounded-md border border-border/60 bg-card/60 p-0.5">
            {segments.map(seg => (
              <Button
                key={seg.value}
                size="sm"
                variant={segmentValue === seg.value ? "default" : "ghost"}
                className="h-7 px-2 text-xs gap-1"
                onClick={() => onSegmentChange?.(seg.value)}
              >
                {seg.label}
                {typeof seg.count === "number" && (
                  <span className="text-[10px] opacity-70">{seg.count}</span>
                )}
              </Button>
            ))}
          </div>
        )}

        {trailing}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Filter className="h-3 w-3" />
          {resultCount.toLocaleString()} of {totalCount.toLocaleString()} {noun}
          {totalCount === 1 ? "" : "s"}
          {count > 0 && ` • ${count} filter${count === 1 ? "" : "s"}`}
        </span>

        {selectedTags.map(t => (
          <Badge key={t.code} variant="secondary" className="gap-1 pr-1">
            {t.label}
            <button
              onClick={() => toggleTag(t.code)}
              className="ml-1 rounded-full p-0.5 hover:bg-muted"
              aria-label={`Remove ${t.label} tag filter`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}

        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onChange({ ...EMPTY_IDENTIFIER_FILTER })}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, CalendarRange, Maximize2, Radio, Trash2, X } from "lucide-react";
import { ScoreBars } from "./ScoreBars";
import {
  CATEGORY_GRADIENTS,
  DATE_PRESETS,
  SAVED_SORTS,
  SavedAnalysis,
  SavedSort,
  relative,
} from "@/lib/semanticAnalysis";

interface LatestSavedAnalysisCardProps {
  savedQuery: string;
  setSavedQuery: (v: string) => void;
  savedSort: SavedSort;
  setSavedSort: (v: SavedSort) => void;
  selectedSaved: SavedAnalysis | null;
  setSelectedSavedId: (v: string) => void;
  visibleSaved: SavedAnalysis[];
  saved: SavedAnalysis[];
  savedTotal: number;
  savedLoading: boolean;
  loadSaved: (append?: boolean) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  applyPreset: (days: number | null) => void;
  activePreset: string | null;
  setDrawerOpen: (v: boolean) => void;
  setPendingDelete: (a: SavedAnalysis | null) => void;
  navigate: (path: string) => void;
}

export const LatestSavedAnalysisCard = ({
  savedQuery,
  setSavedQuery,
  savedSort,
  setSavedSort,
  selectedSaved,
  setSelectedSavedId,
  visibleSaved,
  saved,
  savedTotal,
  savedLoading,
  loadSaved,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  applyPreset,
  activePreset,
  setDrawerOpen,
  setPendingDelete,
  navigate,
}: LatestSavedAnalysisCardProps) => {
  return (
    <Card className="mt-6 border-border/60 bg-card/70 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Radio className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Latest saved analysis</h2>
        <div className="ml-auto flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Input
            value={savedQuery}
            onChange={(e) => setSavedQuery(e.target.value)}
            placeholder="Search by source name or date…"
            className="h-9 w-full sm:w-52"
          />
          <Select value={savedSort} onValueChange={(v) => setSavedSort(v as SavedSort)}>
            <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Sort analyses">
              <ArrowUpDown className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SAVED_SORTS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="w-full sm:w-80">
            <Select
              value={selectedSaved?.id ?? ""}
              onValueChange={setSelectedSavedId}
              disabled={!visibleSaved.length}
            >
              <SelectTrigger className="h-9">
                <SelectValue
                  placeholder={
                    savedLoading
                      ? "Loading analyses…"
                      : visibleSaved.length
                        ? "Select a saved analysis"
                        : savedQuery
                          ? "No matches"
                          : "No saved analyses yet"
                  }
                />
              </SelectTrigger>
              <SelectContent
                className="max-h-72"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  if (
                    !savedLoading &&
                    saved.length < savedTotal &&
                    el.scrollTop + el.clientHeight >= el.scrollHeight - 24
                  ) {
                    loadSaved(true);
                  }
                }}
              >
                {visibleSaved.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.source_name} — {relative(a.created_at)}
                  </SelectItem>
                ))}
                {saved.length < savedTotal && (
                  <div className="px-2 py-2 text-center text-[11px] text-muted-foreground">
                    {savedLoading
                      ? "Loading more…"
                      : `Scroll for more (${saved.length}/${savedTotal})`}
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/20 p-2">
        <CalendarRange className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-medium text-muted-foreground">Date range</span>
        {DATE_PRESETS.map(([label, days]) => (
          <Button
            key={label}
            size="sm"
            variant={activePreset === label ? "secondary" : "ghost"}
            className="h-7 px-2 text-[11px]"
            onClick={() => applyPreset(days)}
          >
            {label}
          </Button>
        ))}
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="From date"
            className="h-7 w-[9.5rem] text-[11px]"
          />
          <span className="text-[11px] text-muted-foreground">to</span>
          <Input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="To date"
            className="h-7 w-[9.5rem] text-[11px]"
          />
        </div>
        {(dateFrom || dateTo) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
          >
            <X className="mr-1 h-3 w-3" />
            Clear dates
          </Button>
        )}
      </div>

      {savedLoading && !saved.length ? (
        <div className="mt-4 space-y-3" aria-busy="true">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2.5 w-full" />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">Fetching saved analyses…</p>
        </div>
      ) : selectedSaved ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{selectedSaved.source_name}</p>
            {selectedSaved.category && (
              <Badge
                variant="secondary"
                className="text-[11px]"
                style={{
                  backgroundImage:
                    CATEGORY_GRADIENTS[selectedSaved.category.toLowerCase()] ?? undefined,
                }}
              >
                {selectedSaved.category}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              confidence {Math.round(Number(selectedSaved.confidence ?? 0) * 100)}% ·{" "}
              {relative(selectedSaved.created_at)}
            </span>
          </div>
          <ScoreBars ana={selectedSaved} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setDrawerOpen(true)}>
              <Maximize2 className="mr-1.5 h-3.5 w-3.5" />
              View full details
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setPendingDelete(selectedSaved)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete analysis
            </Button>
          </div>
          {savedTotal > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Showing {saved.length} of {savedTotal} saved analyses
              {saved.length < savedTotal ? " — scroll the picker to load more." : "."}
            </p>
          )}
        </div>
      ) : savedQuery.trim() ? (
        <div className="mt-4 rounded-lg border border-dashed border-border/70 bg-muted/20 p-5 text-center">
          <Radio className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">No analyses match “{savedQuery.trim()}”</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Try a different source name, or a date fragment such as “2026-08”.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setSavedQuery("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border/70 bg-muted/20 p-5 text-center">
          <Radio className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-2 text-sm font-semibold">No saved analyses yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Nothing has been scored through the ontology so far. Run a data stream ingest to
            create the first activation profile, then its analysis will appear here
            automatically.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Button
              size="sm"
              onClick={() =>
                document
                  .getElementById("data-stream-wizard")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              Run a data stream ingest
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/admin/pipeline")}>
              Open Intuizi Console
            </Button>
            <Button variant="ghost" size="sm" onClick={() => loadSaved()} disabled={savedLoading}>
              Check again
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

export default LatestSavedAnalysisCard;

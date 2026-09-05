import { Globe2, Loader2, Store, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OriginalityBadge } from "@/components/OriginalityBadge";
import {
  MarketOriginalityBadge,
  MarketOriginalityPanel,
} from "@/components/catalog/MarketOriginalityPanel";
import { formatCents, type Rollup, type SymbolStat } from "@/lib/catalogOriginality";
import type { MarketOriginality } from "@/lib/marketOriginality";
import { CatalogItem, KIND_META } from "./catalogTypes";

interface CatalogItemCardProps {
  item: CatalogItem;
  parent: CatalogItem | null | undefined;
  roll: Rollup | undefined;
  market: MarketOriginality | undefined;
  bySymbol: Map<string, SymbolStat>;
  priceDraft: Record<string, string>;
  setPriceDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  listBusy: string | null;
  marketOpen: string | null;
  setMarketOpen: React.Dispatch<React.SetStateAction<string | null>>;
  onRemove: (id: string) => void;
  onToggleListing: (item: CatalogItem) => void;
}

export const CatalogItemCard = ({
  item,
  parent,
  roll,
  market,
  bySymbol,
  priceDraft,
  setPriceDraft,
  listBusy,
  marketOpen,
  setMarketOpen,
  onRemove,
  onToggleListing,
}: CatalogItemCardProps) => {
  const Icon = KIND_META[item.kind].icon;
  return (
    <li>
      <Card className="flex h-full flex-col gap-2 border-border/60 bg-card/70 p-3">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{item.title}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {[item.artist, item.label_name, item.release_year]
                .filter(Boolean)
                .join(" · ") || KIND_META[item.kind].label}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => onRemove(item.id)}
            aria-label={`Remove ${item.title}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="secondary" className="text-[10px]">
            {KIND_META[item.kind].label}
          </Badge>
          {parent && (
            <Badge variant="outline" className="text-[10px]">
              in {parent.title}
            </Badge>
          )}
          {item.audio_source_id && (
            <Badge variant="outline" className="text-[10px]">
              audio linked
            </Badge>
          )}
          {roll?.score !== null && roll?.score !== undefined && (
            <OriginalityBadge
              score={roll.score}
              detail={{
                summary:
                  roll.basis === "symbols"
                    ? `Weighted across ${roll.symbols} symbol${roll.symbols === 1 ? "" : "s"} from ${roll.tracks} scored track${roll.tracks === 1 ? "" : "s"}.`
                    : "Measured from this track's own analysis.",
              }}
            />
          )}
          {market && <MarketOriginalityBadge market={market} />}
          {item.kind !== "track" && roll?.score === null && (
            <span className="text-[10px] text-muted-foreground">
              no scored tracks yet
            </span>
          )}
          {(item.symbols ?? []).map((sym) => {
            const stat = bySymbol.get(sym);
            return (
              <Badge
                key={sym}
                className="bg-primary/10 text-[10px] text-primary"
                title={
                  stat
                    ? `Originality ${stat.score} across ${stat.tracks} track(s)`
                    : "No scored tracks carry this symbol yet"
                }
              >
                {sym}
                {stat ? ` · ${stat.score}` : ""}
              </Badge>
            );
          })}
        </div>

        {item.notes && (
          <p className="text-[11px] text-muted-foreground">{item.notes}</p>
        )}

        {item.kind === "track" && (
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
            {item.for_sale ? (
              <>
                <Badge className="bg-emerald-500/15 text-[10px] text-emerald-600">
                  Listed{" "}
                  {formatCents(item.price_cents, item.currency ?? "USD") ?? ""}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7 text-[10px]"
                  disabled={listBusy === item.id}
                  onClick={() => void onToggleListing(item)}
                >
                  {listBusy === item.id ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : null}
                  Unlist
                </Button>
              </>
            ) : (
              <>
                <Input
                  value={priceDraft[item.id] ?? ""}
                  onChange={(e) =>
                    setPriceDraft((prev) => ({ ...prev, [item.id]: e.target.value }))
                  }
                  inputMode="decimal"
                  placeholder="Price USD"
                  className="h-7 w-24 text-[11px]"
                  aria-label={`Price for ${item.title}`}
                />
                <Button
                  size="sm"
                  className="ml-auto h-7 text-[10px]"
                  disabled={listBusy === item.id}
                  onClick={() => void onToggleListing(item)}
                >
                  {listBusy === item.id ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Store className="mr-1 h-3 w-3" />
                  )}
                  List for sale
                </Button>
              </>
            )}
          </div>
        )}

        {market && (
          <div className="border-t border-border/50 pt-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-1 text-[10px]"
              onClick={() =>
                setMarketOpen((prev) => (prev === item.id ? null : item.id))
              }
              aria-expanded={marketOpen === item.id}
            >
              <Globe2 className="mr-1 h-3 w-3" />
              {marketOpen === item.id ? "Hide" : "Compare to"} the real market
            </Button>
          </div>
        )}
      </Card>

      {market && marketOpen === item.id && (
        <div className="mt-2">
          <MarketOriginalityPanel title={item.title} market={market} />
        </div>
      )}
    </li>
  );
};

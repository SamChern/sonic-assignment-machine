import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Loader2, Network } from "lucide-react";
import { toast } from "sonner";
import { IntuiziCatalogTree } from "@/components/admin/IntuiziCatalogTree";
import { CATALOG_DATASETS, type CatalogNode } from "@/lib/intuiziTaxonomy";

export const ReferenceCatalogPanel = ({
  refDataset,
  setRefDataset,
  refCatalog,
  setRefCatalog,
  refTree,
  setRefTree,
  refRaw,
  refBusy,
  refError,
  setRefError,
  loadReference,
}: {
  refDataset: string;
  setRefDataset: (v: string) => void;
  refCatalog: string;
  setRefCatalog: (v: string) => void;
  refTree: { roots: CatalogNode[]; synthesized: number };
  setRefTree: (v: { roots: CatalogNode[]; synthesized: number }) => void;
  refRaw: string;
  refBusy: boolean;
  refError: string | null;
  setRefError: (v: string | null) => void;
  loadReference: () => void;
}) => {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px]">
          <Label className="text-[11px]">Dataset</Label>
          <Select
            value={refDataset}
            onValueChange={(v) => {
              setRefDataset(v);
              const first = CATALOG_DATASETS.find((d) => d.dataset === v)?.catalogs[0];
              if (first) setRefCatalog(first.catalog);
              setRefTree({ roots: [], synthesized: 0 });
              setRefError(null);
            }}
          >
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATALOG_DATASETS.map((d) => (
                <SelectItem key={d.dataset} value={d.dataset}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[200px]">
          <Label className="text-[11px]">Catalog</Label>
          <Select value={refCatalog} onValueChange={setRefCatalog}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(CATALOG_DATASETS.find((d) => d.dataset === refDataset)?.catalogs ?? []).map((c) => (
                <SelectItem key={c.catalog} value={c.catalog}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={loadReference} disabled={refBusy}>
          {refBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Network className="mr-1 h-4 w-4" />}
          Lookup
        </Button>
        {(() => {
          const hint = CATALOG_DATASETS.find((d) => d.dataset === refDataset)
            ?.catalogs.find((c) => c.catalog === refCatalog)?.hint;
          return hint ? (
            <span className="text-[11px] text-muted-foreground">{hint}</span>
          ) : null;
        })()}
      </div>

      {refError && (
        <p className="text-[11px] text-destructive">{refError}</p>
      )}

      <IntuiziCatalogTree
        roots={refTree.roots}
        synthesizedParents={refTree.synthesized}
        onPick={(node) => {
          void navigator.clipboard.writeText(node.id);
          toast.success(`Copied ${node.label} → ${node.id}`);
        }}
      />

      {!!refRaw && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <ChevronDown className="h-3 w-3" /> raw catalog payload
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted/30 p-2 text-[10px]">{refRaw}</pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
};

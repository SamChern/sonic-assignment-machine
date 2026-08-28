import { useMemo, useState } from "react";
import { Check, ChevronRight, Copy, Layers, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  countNodes,
  filterCatalogTree,
  type CatalogNode,
} from "@/lib/intuiziTaxonomy";

/** One proposed AudioSet mapping awaiting (or holding) an admin decision. */
export interface CrosswalkProposal {
  code: string;
  label: string | null;
  similarity: number;
  approved: boolean;
  rejected?: boolean;
}

export type CrosswalkDecision = "approve" | "reject" | "clear";

interface CrosswalkProps {
  /** Proposals keyed by taxonomy code (== CatalogNode.id here). */
  crosswalk?: Record<string, CrosswalkProposal[]>;
  onDecide?: (code: string, target: string, decision: CrosswalkDecision) => void;
  decidingCode?: string | null;
}

interface RowProps extends CrosswalkProps {
  node: CatalogNode;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onPick?: (node: CatalogNode) => void;
}

const CrosswalkRows = ({
  code,
  proposals,
  depth,
  onDecide,
  busy,
}: {
  code: string;
  proposals: CrosswalkProposal[];
  depth: number;
  onDecide?: (code: string, target: string, decision: CrosswalkDecision) => void;
  busy: boolean;
}) => (
  <div className="space-y-1" style={{ paddingLeft: `${depth * 14 + 26}px` }}>
    {proposals.map((p) => (
      <div
        key={p.code}
        className="flex flex-wrap items-center gap-1.5 rounded border border-border/50 bg-muted/20 px-1.5 py-1"
      >
        <span className="font-mono text-[10px] text-muted-foreground">{p.code}</span>
        <span className="truncate text-[10px]">{p.label ?? ""}</span>
        <Badge variant="outline" className="px-1 py-0 text-[9px]">
          {(p.similarity * 100).toFixed(0)}%
        </Badge>
        {p.approved && (
          <Badge className="px-1 py-0 text-[9px]" variant="secondary">approved</Badge>
        )}
        {p.rejected && !p.approved && (
          <Badge variant="outline" className="px-1 py-0 text-[9px] text-muted-foreground">
            rejected
          </Badge>
        )}
        {onDecide && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              className="h-6 px-1.5 text-[10px]"
              onClick={() => onDecide(code, p.code, p.approved ? "clear" : "approve")}
              aria-label={p.approved ? `Unapprove ${p.code}` : `Approve mapping ${p.code}`}
            >
              <Check className="mr-0.5 h-3 w-3" />
              {p.approved ? "Undo" : "Approve"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              className="h-6 px-1.5 text-[10px]"
              onClick={() => onDecide(code, p.code, "reject")}
              aria-label={`Reject mapping ${p.code}`}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    ))}
    {!proposals.length && (
      <p className="text-[10px] text-muted-foreground">No AudioSet proposals yet.</p>
    )}
  </div>
);

const NodeRow = ({
  node,
  depth,
  expanded,
  toggle,
  onPick,
  crosswalk,
  onDecide,
  decidingCode,
}: RowProps) => {
  const open = expanded.has(node.id);
  const hasKids = node.children.length > 0;
  const metaEntries = Object.entries(node.meta).filter(([k]) => k !== "synthesized");
  const proposals = crosswalk?.[node.id];
  const approvedCount = (proposals ?? []).filter((p) => p.approved).length;


  return (
    <div>
      <div
        className="group flex items-center gap-1 rounded-md px-1 py-1 transition-colors hover:bg-primary/5"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <button
          onClick={() => hasKids && toggle(node.id)}
          className={`flex h-4 w-4 shrink-0 items-center justify-center ${hasKids ? "" : "opacity-0"}`}
          aria-label={open ? "Collapse" : "Expand"}
        >
          <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        <button
          onClick={() => (onPick ? onPick(node) : hasKids && toggle(node.id))}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        >
          <span className="truncate text-xs">{node.label}</span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{node.id}</span>
          {hasKids && (
            <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px]">
              {countNodes(node.children)}
            </Badge>
          )}
          {!!proposals && (
            <Badge
              variant={approvedCount > 0 ? "secondary" : "outline"}
              className={`shrink-0 px-1 py-0 text-[9px] ${approvedCount > 0 ? "" : "text-amber-500"}`}
            >
              {approvedCount > 0 ? `${approvedCount} mapped` : `${proposals.length} proposed`}
            </Badge>
          )}
        </button>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(node.id);
            toast.success(`Copied ${node.id}`);
          }}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Copy id"
        >
          <Copy className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
      {open && !!metaEntries.length && (
        <p
          className="truncate text-[10px] text-muted-foreground"
          style={{ paddingLeft: `${depth * 14 + 26}px` }}
        >
          {metaEntries.map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
        </p>
      )}
      {open && !!proposals && (
        <CrosswalkRows
          code={node.id}
          proposals={proposals}
          depth={depth}
          onDecide={onDecide}
          busy={decidingCode === node.id}
        />
      )}
      {open &&
        node.children.map((child) => (
          <NodeRow
            key={`${child.parentId ?? "root"}-${child.id}`}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            onPick={onPick}
            crosswalk={crosswalk}
            onDecide={onDecide}
            decidingCode={decidingCode}
          />
        ))}
    </div>
  );
};

interface Props extends CrosswalkProps {
  roots: CatalogNode[];
  /** Number of parents inferred from child rows rather than returned directly. */
  synthesizedParents?: number;
  onPick?: (node: CatalogNode) => void;
  emptyHint?: string;
}

/** Nested, searchable view of an Intuizi reference catalog. */
export const IntuiziCatalogTree = ({
  roots,
  synthesizedParents = 0,
  onPick,
  crosswalk,
  onDecide,
  decidingCode,
  emptyHint,
}: Props) => {

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => filterCatalogTree(roots, query), [roots, query]);
  const total = useMemo(() => countNodes(roots), [roots]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const collectIds = (nodes: CatalogNode[], acc: string[] = []): string[] => {
    nodes.forEach((n) => {
      if (n.children.length) {
        acc.push(n.id);
        collectIds(n.children, acc);
      }
    });
    return acc;
  };

  if (!roots.length) {
    return (
      <p className="text-[11px] text-muted-foreground">
        {emptyHint ??
          "No catalog entries loaded yet — pick a dataset and catalog above, then hit Lookup."}
      </p>
    );
  }


  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="h-3.5 w-3.5 text-primary" />
        <Badge variant="outline" className="text-[10px]">{total} entries</Badge>
        <Badge variant="outline" className="text-[10px]">{roots.length} top-level</Badge>
        {!!synthesizedParents && (
          <Badge variant="outline" className="text-[10px] text-amber-500">
            {synthesizedParents} inferred parents
          </Badge>
        )}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter categories…"
          className="h-8 w-40 text-xs"
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px]"
          onClick={() => setExpanded(new Set(collectIds(filtered)))}
        >
          Expand all
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px]"
          onClick={() => setExpanded(new Set())}
        >
          Collapse
        </Button>
      </div>
      <div className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/50 p-1">
        {filtered.map((node) => (
          <NodeRow
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            toggle={toggle}
            onPick={onPick}
            crosswalk={crosswalk}
            onDecide={onDecide}
            decidingCode={decidingCode}
          />
        ))}

        {!filtered.length && (
          <p className="p-2 text-[11px] text-muted-foreground">No entries match “{query}”.</p>
        )}
      </div>
    </div>
  );
};

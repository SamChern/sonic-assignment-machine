import { useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Archive, ArchiveRestore } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { GuideDraft, GuideEntry, GuideKind, GuideStatus } from "@/hooks/useAdminGuide";

const STATUS_STYLE: Record<GuideStatus, string> = {
  live: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  partial: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  planned: "border-border/60 bg-muted/40 text-muted-foreground",
};

const STATUS_LABEL: Record<GuideStatus, string> = {
  live: "Live",
  partial: "Partial",
  planned: "Not built yet",
};

export const StatusBadge = ({ status }: { status: GuideStatus }) => (
  <Badge
    variant="outline"
    aria-label={`Status: ${STATUS_LABEL[status]}`}
    className={`shrink-0 text-[11px] ${STATUS_STYLE[status]}`}
  >
    {STATUS_LABEL[status]}
  </Badge>
);

/** One glossary term. Compact, definition-first. */
export const GlossaryItem = ({
  entry,
  onEdit,
}: {
  entry: GuideEntry;
  onEdit: (e: GuideEntry) => void;
}) => (
  <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{entry.title}</p>
        <p className="text-xs text-muted-foreground">{entry.category}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <StatusBadge status={entry.status} />
        <Button variant="ghost" size="icon" aria-label="Edit entry" onClick={() => onEdit(entry)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
      {entry.body}
    </p>
  </Card>
);

/** One subsystem runbook card: what it is, how to verify, where it lives. */
export const RunbookItem = ({
  entry,
  onEdit,
  onArchive,
}: {
  entry: GuideEntry;
  onEdit: (e: GuideEntry) => void;
  onArchive: (e: GuideEntry) => void;
}) => (
  <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{entry.title}</p>
        <p className="text-xs text-muted-foreground">{entry.category}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <StatusBadge status={entry.status} />
        <Button variant="ghost" size="icon" aria-label="Edit entry" onClick={() => onEdit(entry)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={entry.archived ? "Restore entry" : "Archive entry"}
          onClick={() => onArchive(entry)}
        >
          {entry.archived ? (
            <ArchiveRestore className="h-3.5 w-3.5" />
          ) : (
            <Archive className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
      {entry.body}
    </p>
    {entry.verify_note && (
      <p className="mt-2 rounded-md border border-border/60 bg-muted/30 p-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Verify: </span>
        {entry.verify_note}
      </p>
    )}
    {(entry.related_routes.length > 0 || entry.related_functions.length > 0) && (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {entry.related_routes.map((r) => (
          <Link key={r} to={r}>
            <Badge variant="secondary" className="text-[11px]">
              {r}
            </Badge>
          </Link>
        ))}
        {entry.related_functions.map((f) => (
          <Badge key={f} variant="outline" className="text-[11px] text-muted-foreground">
            fn: {f}
          </Badge>
        ))}
      </div>
    )}
  </Card>
);

const emptyDraft = (kind: GuideKind): GuideDraft => ({
  slug: "",
  title: "",
  kind,
  category: "General",
  body: "",
  status: "live",
  verify_note: null,
});

/** Inline editor for a glossary term or runbook card. */
export const GuideEditor = ({
  entry,
  kind,
  onCancel,
  onSave,
}: {
  entry: GuideEntry | null;
  kind: GuideKind;
  onCancel: () => void;
  onSave: (draft: GuideDraft, id?: string) => Promise<void>;
}) => {
  const [draft, setDraft] = useState<GuideDraft>(
    entry
      ? {
          slug: entry.slug,
          title: entry.title,
          kind: entry.kind,
          category: entry.category,
          body: entry.body,
          status: entry.status,
          verify_note: entry.verify_note,
          related_routes: entry.related_routes,
          related_functions: entry.related_functions,
          sort_order: entry.sort_order,
        }
      : emptyDraft(kind),
  );
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onSave(draft, entry?.id);
      onCancel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/40 bg-card/80 p-4 backdrop-blur-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="guide-title">Title</Label>
          <Input
            id="guide-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="guide-slug">Slug</Label>
          <Input
            id="guide-slug"
            value={draft.slug}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="guide-category">Category</Label>
          <Input
            id="guide-category"
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="guide-status">Status</Label>
          <select
            id="guide-status"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as GuideStatus })}
          >
            <option value="live">Live</option>
            <option value="partial">Partial</option>
            <option value="planned">Not built yet</option>
          </select>
        </div>
      </div>
      <div className="mt-3">
        <Label htmlFor="guide-body">Body</Label>
        <Textarea
          id="guide-body"
          rows={5}
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        />
      </div>
      {draft.kind === "runbook" && (
        <div className="mt-3">
          <Label htmlFor="guide-verify">Verify note</Label>
          <Textarea
            id="guide-verify"
            rows={2}
            value={draft.verify_note ?? ""}
            onChange={(e) => setDraft({ ...draft, verify_note: e.target.value || null })}
          />
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy || !draft.title || !draft.slug} onClick={() => void submit()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
};

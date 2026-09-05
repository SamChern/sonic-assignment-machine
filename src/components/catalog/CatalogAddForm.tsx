import { Loader2, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CatalogItem, Kind, KIND_META } from "./catalogTypes";

export interface CatalogFormState {
  kind: Kind;
  title: string;
  artist: string;
  label_name: string;
  release_year: string;
  parent_id: string;
  audio_source_id: string;
  symbols: string;
  notes: string;
}

interface CatalogAddFormProps {
  form: CatalogFormState;
  setForm: React.Dispatch<React.SetStateAction<CatalogFormState>>;
  parents: CatalogItem[];
  mySources: { id: string; name: string }[] | undefined;
  saving: boolean;
  onSubmit: () => void;
}

export const CatalogAddForm = ({
  form,
  setForm,
  parents,
  mySources,
  saving,
  onSubmit,
}: CatalogAddFormProps) => {
  return (
    <Card className="space-y-4 border-border/60 bg-card/70 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Add to catalog</h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Type</Label>
          <Select
            value={form.kind}
            onValueChange={(v) => setForm((f) => ({ ...f, kind: v as Kind, parent_id: "" }))}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="label">Label</SelectItem>
              <SelectItem value="album">Album</SelectItem>
              <SelectItem value="track">Track</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Title</Label>
          <Input
            className="h-9 text-xs"
            value={form.title}
            maxLength={200}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder={form.kind === "label" ? "Imprint name" : "Release or track name"}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Artist</Label>
          <Input
            className="h-9 text-xs"
            value={form.artist}
            maxLength={200}
            onChange={(e) => setForm((f) => ({ ...f, artist: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Label name</Label>
          <Input
            className="h-9 text-xs"
            value={form.label_name}
            maxLength={200}
            onChange={(e) => setForm((f) => ({ ...f, label_name: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Release year</Label>
          <Input
            className="h-9 text-xs"
            inputMode="numeric"
            value={form.release_year}
            maxLength={4}
            onChange={(e) => setForm((f) => ({ ...f, release_year: e.target.value }))}
          />
        </div>

        {form.kind !== "label" && (
          <div className="space-y-1.5">
            <Label className="text-xs">
              {form.kind === "track" ? "Belongs to album" : "Belongs to label"}
            </Label>
            <Select
              value={form.parent_id || "none"}
              onValueChange={(v) => setForm((f) => ({ ...f, parent_id: v === "none" ? "" : v }))}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {parents.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {form.kind === "track" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Linked audio source</Label>
            <Select
              value={form.audio_source_id || "none"}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, audio_source_id: v === "none" ? "" : v }))
              }
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {(mySources ?? []).slice(0, 100).map((s: { id: string; name: string }) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Symbols (comma separated)</Label>
          <Input
            className="h-9 text-xs"
            value={form.symbols}
            onChange={(e) => setForm((f) => ({ ...f, symbols: e.target.value }))}
            placeholder="e.g. torchbearer, late-night, analog warmth"
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <Label className="text-xs">Notes</Label>
          <Textarea
            className="min-h-[64px] text-xs"
            value={form.notes}
            maxLength={1000}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </div>

      <Button size="sm" onClick={onSubmit} disabled={saving} className="text-xs">
        {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
        Add {KIND_META[form.kind].label.toLowerCase()}
      </Button>
    </Card>
  );
};

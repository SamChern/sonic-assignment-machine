import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquarePlus, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getCategoryStyles } from "@/components/AnalysisResults";
import { cn } from "@/lib/utils";

const CATS = ["emotional", "cognitive", "social", "communication", "contextual", "artistic"] as const;
type Cat = typeof CATS[number];

interface Props {
  audioSourceId: string;
  currentScores: Record<string, number>; // keyed by lowercase category name
}

export function FeedbackPopover({ audioSourceId, currentScores }: Props) {
  const { user, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [original, setOriginal] = useState<Record<Cat, number>>({} as any);
  const [edited, setEdited] = useState<Record<Cat, number>>({} as any);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isAdmin) return null;

  const handleOpenChange = async (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("source_analyses")
        .select("id,emotional_score,cognitive_score,social_score,communication_score,contextual_score,artistic_score")
        .eq("audio_source_id", audioSourceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("No analysis found for this source");
      const base: Record<Cat, number> = {
        emotional: Number(data.emotional_score ?? currentScores.emotional ?? 0),
        cognitive: Number(data.cognitive_score ?? currentScores.cognitive ?? 0),
        social: Number(data.social_score ?? currentScores.social ?? 0),
        communication: Number(data.communication_score ?? currentScores.communication ?? 0),
        contextual: Number(data.contextual_score ?? currentScores.contextual ?? 0),
        artistic: Number(data.artistic_score ?? currentScores.artistic ?? 0),
      };
      setAnalysisId(data.id);
      setOriginal(base);
      setEdited({ ...base });
      setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load analysis");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!analysisId || !user) return;
    const rows = CATS
      .filter(c => Math.round(edited[c]) !== Math.round(original[c]))
      .map(c => ({
        source_analysis_id: analysisId,
        category: c,
        corrected_score: edited[c],
        delta: edited[c] - original[c],
        rater_user_id: user.id,
        note: note || null,
      }));
    if (rows.length === 0) {
      toast.info("No score changes to submit");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("category_feedback").insert(rows);
      if (error) throw error;
      toast.success(`Saved ${rows.length} correction${rows.length === 1 ? "" : "s"}`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save feedback");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs gap-1"
          title="Admin: correct category scores"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Feedback
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading scores…
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold">Correct scores</h4>
              <p className="text-[11px] text-muted-foreground">
                Edit any of the 6 dimensions (0–100). Only changed values are written to category_feedback.
              </p>
            </div>
            <div className="space-y-2">
              {CATS.map(c => {
                const styles = getCategoryStyles(c);
                const orig = original[c] ?? 0;
                const val = edited[c] ?? 0;
                const changed = Math.round(val) !== Math.round(orig);
                return (
                  <div key={c} className="flex items-center gap-2">
                    <Label className={cn("w-24 text-xs capitalize", styles.text)}>
                      {c}
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={val}
                      onChange={e => setEdited(s => ({ ...s, [c]: Number(e.target.value) }))}
                      className="h-7 text-xs flex-1"
                    />
                    <span className={cn(
                      "w-14 text-right text-[11px] tabular-nums",
                      changed ? "text-foreground font-medium" : "text-muted-foreground"
                    )}>
                      {changed ? `${val - orig > 0 ? "+" : ""}${(val - orig).toFixed(0)}` : `was ${orig}`}
                    </span>
                  </div>
                );
              })}
            </div>
            <Textarea
              placeholder="Optional note for calibration…"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="text-xs min-h-[60px]"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={submitting}>
                {submitting ? "Saving…" : "Submit"}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

import { useEffect, useState } from "react";
import { Ear, Link2, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

/**
 * Step 14b — "honest scores". Says how a score knew what it knew:
 *   Grounded  — real audio was measured (or a tag backed by listened-to sound).
 *   Bridged   — tag vectors carried into the catalog space / measured neighbours.
 *   Text-only — label semantics only.
 */
type Level = "text-only" | "bridged" | "grounded";

const STYLES: Record<Level, { label: string; cls: string; hint: string; Icon: typeof Ear }> = {
  grounded: {
    label: "Grounded",
    cls: "border-primary/40 bg-primary/10 text-primary",
    hint: "Scored with measured audio evidence.",
    Icon: Ear,
  },
  bridged: {
    label: "Bridged",
    cls: "border-secondary/40 bg-secondary/20 text-secondary-foreground",
    hint: "No measured audio for this source: scored via bridged tag vectors and measured neighbours.",
    Icon: Link2,
  },
  "text-only": {
    label: "Text-only",
    cls: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
    hint: "Scored from label semantics only — the weakest claim we make.",
    Icon: Type,
  },
};

/** Everyday wording for the consumer door — same three states, no jargon. */
const PLAIN: Record<Level, { label: string; hint: string }> = {
  grounded: {
    label: "We listened",
    hint: "We measured the actual sound of this track.",
  },
  bridged: {
    label: "Close match",
    hint: "We couldn't hear this one directly, so we used sounds we know that are very like it.",
  },
  "text-only": {
    label: "Best guess",
    hint: "Based on the words describing this sound, not the sound itself.",
  },
};

export const GroundingBadge = ({
  audioSourceId,
  level,
  className,
  plain = false,
}: {
  audioSourceId?: string;
  level?: Level;
  className?: string;
  /** Use plain-language wording (consumer views). */
  plain?: boolean;
}) => {
  const [resolved, setResolved] = useState<Level | null>(level ?? null);

  useEffect(() => {
    if (level || !audioSourceId) return;
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("source_analyses")
        .select("grounding_level")
        .eq("audio_source_id", audioSourceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (active && data?.grounding_level) setResolved(data.grounding_level as Level);
    })();
    return () => {
      active = false;
    };
  }, [audioSourceId, level]);

  if (!resolved) return null;
  const { label, cls, hint, Icon } = STYLES[resolved] ?? STYLES["text-only"];

  return (
    <span
      title={hint}
      aria-label={`${label} — ${hint}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        cls,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
};

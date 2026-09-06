import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { CATEGORIES, GRADIENTS, clamp, type Category } from "@/lib/speechNormalization";

interface Props {
  raw: Record<Category, number>;
  preview: Record<Category, number>;
  sampleLabel?: string;
  dominant: { before: Category; after: Category };
}

const LivePreview = ({ raw, preview, sampleLabel, dominant }: Props) => {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        Live preview
        <span className="ml-auto text-[11px] font-normal text-muted-foreground">
          {sampleLabel ?? "speech-skewed archetype"}
        </span>
      </div>

      <div className="mt-3 space-y-2.5">
        {CATEGORIES.map((c) => {
          const a = raw[c] ?? 0;
          const b = preview[c] ?? 0;
          const d = b - a;
          return (
            <div key={c}>
              <div className="flex items-center justify-between text-[11px]">
                <span className="capitalize">{c}</span>
                <span className="font-mono">
                  {Math.round(a)} → {Math.round(b)}{" "}
                  <span className={d > 0 ? "text-primary" : d < 0 ? "text-destructive" : "text-muted-foreground"}>
                    ({d > 0 ? "+" : ""}
                    {d.toFixed(1)})
                  </span>
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${clamp(b)}%`, background: GRADIENTS[c] }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-2 text-[11px]">
        <span className="text-muted-foreground">Dominant category</span>
        <Badge variant="secondary" className="capitalize">
          {dominant.before}
        </Badge>
        <span className="text-muted-foreground">→</span>
        <Badge className="capitalize">{dominant.after}</Badge>
        {dominant.before !== dominant.after && (
          <span className="text-primary">label flips under these settings</span>
        )}
      </div>
    </div>
  );
};

export default LivePreview;

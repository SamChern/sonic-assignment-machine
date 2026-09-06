import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface ScoreItem {
  key: string;
  name: string;
  color: string;
  value: number;
}

interface Props {
  title: string;
  caption?: string;
  scores: ScoreItem[];
  confidence?: number | null;
  grounding?: string | null;
}

/** The six scores for one sound, or an average, shown as plain labelled bars. */
const ListenerScoreCard = ({ title, caption, scores, confidence, grounding }: Props) => (
  <Card className="space-y-3 p-4">
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {typeof confidence === "number" && Number.isFinite(confidence) && (
          <Badge variant="outline" className="text-[10px]">
            confidence {Math.round(confidence * (confidence <= 1 ? 100 : 1))}%
          </Badge>
        )}
        {grounding && (
          <Badge variant="secondary" className="text-[10px]">
            {grounding.replace(/_/g, " ")}
          </Badge>
        )}
      </div>
    </div>

    <ul className="space-y-2">
      {scores.map((c) => (
        <li key={c.key} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-foreground">{c.name}</span>
            <span className="tabular-nums text-muted-foreground">{c.value}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/40">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(2, Math.min(100, c.value))}%`, backgroundColor: c.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  </Card>
);

export default ListenerScoreCard;

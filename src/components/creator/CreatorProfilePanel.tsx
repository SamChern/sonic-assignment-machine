import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { CreatorWorkRow } from "@/hooks/useCreatorSpace";

const TERM_LABELS: Record<string, string> = {
  no_training: "No machine training",
  analysis_only: "Analysis only",
  licensable: "Available for licensing",
  public_domain: "Public domain",
};

interface Props {
  name: string;
  avatarUrl?: string | null;
  soundCount: number;
  analysedCount: number;
  registeredCount: number;
  sharedCount: number;
  works: CreatorWorkRow[];
}

/** Who the creator is here, and the terms attached to their registered work. */
const CreatorProfilePanel = ({
  name,
  avatarUrl,
  soundCount,
  analysedCount,
  registeredCount,
  sharedCount,
  works,
}: Props) => (
  <div className="space-y-3">
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <Avatar className="h-12 w-12">
        <AvatarImage src={avatarUrl ?? undefined} alt="" />
        <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{name}</p>
        <p className="text-xs text-muted-foreground">
          {soundCount} sounds · {analysedCount} read · {registeredCount} registered ·{" "}
          {sharedCount} shared for licensing
        </p>
      </div>
      <Button asChild size="sm" variant="outline" className="ml-auto">
        <Link to="/creator">
          Register a work
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </Button>
    </Card>

    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Your terms</h2>
      </div>
      {works.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Once you register a work, the terms you chose for it show up here.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {works.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
              <BadgeCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-foreground">{w.title}</span>
              <Badge variant="outline" className="text-[10px]">
                {TERM_LABELS[w.machine_use_terms] ?? w.machine_use_terms}
              </Badge>
              {w.withdrawn_at ? (
                <Badge variant="outline" className="text-[10px]">
                  withdrawn
                </Badge>
              ) : w.corpus_opt_in ? (
                <Badge variant="secondary" className="text-[10px]">
                  shared
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  </div>
);

export default CreatorProfilePanel;

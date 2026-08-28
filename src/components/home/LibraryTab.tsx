import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TasteNeighbors } from "@/components/TasteNeighbors";
import { Library, Users } from "lucide-react";

/**
 * Library — everything already analyzed: this listener's saved analyses plus the
 * taste neighbors those analyses place them next to. "Discover" was never a
 * separate activity; it is what a library is for.
 */
export const LibraryTab = ({
  userId,
  myFingerprint,
  allFingerprints,
  myAnalyses,
}: {
  userId: string | null;
  myFingerprint: any;
  allFingerprints: any[];
  myAnalyses: { id: string; source_name: string; created_at?: string }[];
}) => {
  if (!userId) {
    return (
      <Card className="flex flex-col items-center gap-3 border-dashed border-border/60 bg-card/50 p-10 text-center">
        <Library className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Sign in to keep a library of your analyses and find listeners who share your sonic
          fingerprint.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2">
          <Library className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Saved analyses</h3>
          <Badge variant="secondary" className="text-[11px]">
            {myAnalyses.length}
          </Badge>
        </div>
        {myAnalyses.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing saved yet — analyze a source in Listen and it lands here.
          </p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {myAnalyses.slice(0, 24).map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/10 px-3 py-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">{a.source_name}</span>
                {a.created_at && (
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Taste neighbors</h3>
        </div>
        <TasteNeighbors
          currentUserId={userId}
          currentFingerprint={myFingerprint}
          allFingerprints={allFingerprints}
        />
      </div>
    </div>
  );
};

export default LibraryTab;

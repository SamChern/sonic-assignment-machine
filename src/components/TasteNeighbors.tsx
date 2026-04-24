import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Users, User, Sparkles, Music, FileAudio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  calculateSimilarity,
  FINGERPRINT_CATEGORIES,
  getVector,
  type FingerprintLike,
} from "@/lib/fingerprintMath";
import type { UserFingerprint } from "@/hooks/useFingerprints";

interface TasteNeighborsProps {
  currentUserId: string;
  currentFingerprint: UserFingerprint | null;
  allFingerprints: UserFingerprint[];
  limit?: number;
}

interface NeighborWithSources {
  fingerprint: UserFingerprint;
  similarity: number;
  topSharedCategory: string;
  uniqueSources: Array<{
    id: string;
    name: string;
    album_image: string | null;
    source_type: string;
    artists: string[] | null;
  }>;
}

export const TasteNeighbors = ({
  currentUserId,
  currentFingerprint,
  allFingerprints,
  limit = 5,
}: TasteNeighborsProps) => {
  const [neighbors, setNeighbors] = useState<NeighborWithSources[]>([]);
  const [loading, setLoading] = useState(false);

  // Compute the top-N neighbors by similarity
  const topNeighbors = useMemo(() => {
    if (!currentFingerprint) return [];

    const others = allFingerprints.filter((fp) => fp.user_id !== currentUserId);
    const scored = others.map((fp) => {
      const similarity = calculateSimilarity(currentFingerprint, fp, "all");
      // Find category where both users score highest combined
      const myVec = getVector(currentFingerprint, "all");
      const theirVec = getVector(fp, "all");
      let bestIdx = 0;
      let bestScore = -1;
      myVec.forEach((v, i) => {
        const combined = (v + theirVec[i]) / 2;
        if (combined > bestScore) {
          bestScore = combined;
          bestIdx = i;
        }
      });
      return {
        fingerprint: fp,
        similarity,
        topSharedCategory: FINGERPRINT_CATEGORIES[bestIdx].name,
      };
    });

    return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }, [allFingerprints, currentFingerprint, currentUserId, limit]);

  // Fetch sources for top neighbors and the current user, then diff
  useEffect(() => {
    if (topNeighbors.length === 0 || !currentUserId) {
      setNeighbors([]);
      return;
    }

    let cancelled = false;
    const loadSources = async () => {
      setLoading(true);

      const neighborIds = topNeighbors.map((n) => n.fingerprint.user_id);

      // Fetch in parallel
      const [{ data: mySources }, { data: theirSources }] = await Promise.all([
        supabase
          .from("audio_sources")
          .select("id, name, spotify_id")
          .eq("user_id", currentUserId),
        supabase
          .from("audio_sources")
          .select("id, user_id, name, spotify_id, album_image, source_type, artists")
          .in("user_id", neighborIds),
      ]);

      if (cancelled) return;

      // Build set of "things I already have"
      const myKeys = new Set<string>();
      (mySources || []).forEach((s) => {
        if (s.spotify_id) myKeys.add(`spotify:${s.spotify_id}`);
        myKeys.add(`name:${s.name.toLowerCase().trim()}`);
      });

      const enriched: NeighborWithSources[] = topNeighbors.map((n) => {
        const theirs = (theirSources || []).filter((s) => s.user_id === n.fingerprint.user_id);
        const unique = theirs
          .filter((s) => {
            const sk = s.spotify_id ? `spotify:${s.spotify_id}` : null;
            const nk = `name:${s.name.toLowerCase().trim()}`;
            return !(sk && myKeys.has(sk)) && !myKeys.has(nk);
          })
          .slice(0, 5)
          .map((s) => ({
            id: s.id,
            name: s.name,
            album_image: s.album_image,
            source_type: s.source_type,
            artists: s.artists,
          }));

        return { ...n, uniqueSources: unique };
      });

      setNeighbors(enriched);
      setLoading(false);
    };

    loadSources();
    return () => {
      cancelled = true;
    };
  }, [topNeighbors, currentUserId]);

  if (!currentFingerprint) {
    return (
      <Card className="p-8 text-center bg-card/80">
        <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">
          Analyze some sources first to discover users with similar taste.
        </p>
      </Card>
    );
  }

  if (allFingerprints.length <= 1) {
    return (
      <Card className="p-8 text-center bg-card/80">
        <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">
          No other users to compare with yet. Check back as more people join.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-gradient-to-r from-primary/5 to-secondary/5 border-primary/20">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h4 className="font-semibold text-foreground mb-1">Your Taste Neighbors</h4>
            <p className="text-sm text-muted-foreground">
              Users whose ontological fingerprints align most closely with yours, plus sources
              they have that you haven't analyzed yet.
            </p>
          </div>
        </div>
      </Card>

      {loading && neighbors.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">Finding neighbors…</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {neighbors.map((n) => (
            <Card key={n.fingerprint.user_id} className="p-4 bg-card/80">
              <div className="flex items-center gap-3 mb-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={n.fingerprint.avatar_url || undefined} />
                  <AvatarFallback>
                    <User className="h-5 w-5" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground truncate">
                    {n.fingerprint.username || "Anonymous"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {n.fingerprint.total_sources_analyzed} sources • shared strength:{" "}
                    {n.topSharedCategory}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-primary">
                    {(n.similarity * 100).toFixed(0)}%
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">match</p>
                </div>
              </div>

              {n.uniqueSources.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Try what they're listening to:
                  </p>
                  <ScrollArea className="h-[140px]">
                    <div className="space-y-1.5 pr-3">
                      {n.uniqueSources.map((src) => (
                        <div
                          key={src.id}
                          className="flex items-center gap-2 p-2 rounded-md bg-secondary/20"
                        >
                          {src.album_image ? (
                            <img
                              src={src.album_image}
                              alt=""
                              className="w-8 h-8 rounded flex-shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded bg-secondary/40 flex items-center justify-center flex-shrink-0">
                              {src.source_type === "spotify" ? (
                                <Music className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <FileAudio className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">
                              {src.name}
                            </p>
                            {src.artists && src.artists.length > 0 && (
                              <p className="text-[10px] text-muted-foreground truncate">
                                {src.artists.join(", ")}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              ) : (
                <Badge variant="outline" className="text-xs">
                  You've already explored everything they have
                </Badge>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

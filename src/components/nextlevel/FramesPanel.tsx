import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

/**
 * Frames + sound (item 5). The store for frame vectors exists and is wired to
 * the same taxonomy codes as audio, so a moment can be scored on what is seen
 * and heard together. Honest dependency: frame embedding needs a vision encoder
 * in the grounding pack — until one is registered, nothing is written here.
 */
export function FramesPanel() {
  const [count, setCount] = useState<number | null>(null);
  const [spaces, setSpaces] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const { data, count: total } = await supabase
        .from("frame_embeddings")
        .select("embedding_space", { count: "estimated" })
        .limit(200);
      setCount(total ?? 0);
      setSpaces(Array.from(new Set((data ?? []).map((r) => r.embedding_space).filter(Boolean) as string[])));
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seen and heard together</CardTitle>
        <CardDescription>
          Stills taken from the library's own licensed clips, lined up with the sound at the same
          moment, so a scene can be scored on both at once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{count ?? "…"} frames stored</Badge>
          {spaces.map((s) => (
            <Badge key={s} variant="outline">
              {s}
            </Badge>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          The store and the links to categories are in place. Filling it needs an image model added
          to the grounding pack — that is the one piece still missing, and it isn't something I can
          fake with sound alone.
        </p>
      </CardContent>
    </Card>
  );
}

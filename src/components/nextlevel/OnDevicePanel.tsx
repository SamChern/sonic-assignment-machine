import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RESONANCE_AXES } from "@/lib/nextlevel/resonance";
import { ON_DEVICE_AUDIO_STATUS, onDeviceFingerprint } from "@/lib/nextlevel/onDeviceFingerprint";

/**
 * On-device scoring (item 3), text side: tags to fingerprint computed in the
 * browser, with no model call and no credits spent.
 */
export function OnDevicePanel() {
  const [raw, setRaw] = useState(
    "ctv.genre.news, ctv.format.live, web.weather.rain, iab.music.jazz, spoken word interview",
  );
  const tags = useMemo(
    () =>
      raw
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => ({ code: t, label: t.replace(/[._]/g, " ") })),
    [raw],
  );
  const result = useMemo(() => onDeviceFingerprint(tags), [tags]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scoring in the browser</CardTitle>
        <CardDescription>
          Turns tags into a six-category fingerprint on this device — instant, and it costs nothing
          to run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ondevice-tags">Tags (comma or line separated)</Label>
          <Textarea
            id="ondevice-tags"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={3}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {RESONANCE_AXES.map((axis) => (
            <div key={axis} className="rounded-md border bg-muted/40 p-2">
              <p className="text-xs capitalize text-muted-foreground">{axis}</p>
              <p className="text-lg font-semibold tabular-nums">{result.scores[axis]}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {result.matchedTags} of {result.totalTags} tags recognised
          </Badge>
          <Badge variant="outline">coverage {Math.round(result.coverage * 100)}%</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{ON_DEVICE_AUDIO_STATUS}</p>
      </CardContent>
    </Card>
  );
}

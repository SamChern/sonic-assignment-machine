import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/friendlyError";
import { NEXT_LEVEL_FLAGS, type NextLevelFlag, type NextLevelFlags } from "@/hooks/useNextLevelFlags";

const LABELS: Record<NextLevelFlag, string> = {
  "nextlevel.resonance_enabled": "Resonance Point scores",
  "nextlevel.commons_enabled": "Sonic Commons pool",
  "nextlevel.ondevice_enabled": "Scoring in the browser",
  "nextlevel.hear_api_enabled": "hear() for other systems",
  "nextlevel.frames_enabled": "Seen and heard together",
  "nextlevel.passport_enabled": "Sonic Passport for people",
  "nextlevel.sensory_enabled": "Felt and seen signatures",
  "nextlevel.livecontext_enabled": "The sound of a place",
  "nextlevel.learning_public": "Publish the weekly learning note",
};

interface Props {
  flags: NextLevelFlags;
  loading: boolean;
  setFlag: (key: NextLevelFlag, value: boolean) => Promise<void>;
}

/** Every new capability starts off. Nothing below is visible to anyone else until switched on. */
export function NextLevelFlagsPanel({ flags, loading, setFlag }: Props) {
  const toggle = async (key: NextLevelFlag, value: boolean) => {
    try {
      await setFlag(key, value);
    } catch (err) {
      toast({ title: "Couldn't change that switch", description: friendlyError(err), variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Switches</CardTitle>
        <CardDescription>
          Each capability is off until you turn it on here. While it is off, nobody outside this page
          can reach it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {NEXT_LEVEL_FLAGS.map((key) => (
          <div key={key} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <Label htmlFor={key} className="text-sm">
              {LABELS[key]}
            </Label>
            <Switch
              id={key}
              checked={flags[key]}
              disabled={loading}
              onCheckedChange={(v) => toggle(key, v)}
              aria-label={LABELS[key]}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

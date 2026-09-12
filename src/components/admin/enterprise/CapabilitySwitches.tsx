import { Switch } from "@/components/ui/switch";
import {
  CAPABILITY_KEYS,
  CAPABILITY_LABELS,
  type Capabilities,
  type CapabilityKey,
} from "@/lib/orgCapabilities";

/** The per-account access switches, used for both creating and editing. */
export default function CapabilitySwitches({
  value,
  onChange,
}: {
  value: Capabilities;
  onChange: (next: Capabilities) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {CAPABILITY_KEYS.map((key: CapabilityKey) => (
        <label
          key={key}
          className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3"
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium">{CAPABILITY_LABELS[key].label}</span>
            <span className="block text-xs text-muted-foreground">
              {CAPABILITY_LABELS[key].hint}
            </span>
          </span>
          <Switch
            checked={value[key]}
            onCheckedChange={(checked) => onChange({ ...value, [key]: checked })}
            aria-label={CAPABILITY_LABELS[key].label}
          />
        </label>
      ))}
    </div>
  );
}

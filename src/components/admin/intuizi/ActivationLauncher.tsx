import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const ActivationLauncher = ({
  disabled,
  onActivate,
}: {
  disabled: boolean;
  onActivate: (endpointId: string) => void;
}) => {
  const [endpointId, setEndpointId] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[180px]">
        <Label className="text-[11px]">Endpoint connection id</Label>
        <Input
          value={endpointId}
          onChange={(e) => setEndpointId(e.target.value)}
          placeholder="S3 endpoint connection id"
          className="h-9 text-xs"
        />
      </div>
      <Button size="sm" disabled={disabled || !endpointId.trim()} onClick={() => onActivate(endpointId.trim())}>
        Activate…
      </Button>
    </div>
  );
};

import { Card } from "@/components/ui/card";
import { Wrench } from "lucide-react";
import { type Check } from "@/lib/compatibilityReport";

interface RemediationChecklistCardProps {
  remediations: Check[];
}

export const RemediationChecklistCard = ({ remediations }: RemediationChecklistCardProps) => (
  <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <Wrench className="h-4 w-4 text-primary" />
      Remediation checklist ({remediations.length})
    </h2>
    <ol className="space-y-2 text-xs">
      {remediations.map((c, i) => (
        <li key={c.id} className="flex gap-2">
          <span className="text-muted-foreground">{i + 1}.</span>
          <span>
            <span className="font-medium">{c.title}</span>
            <span className="block text-muted-foreground">{c.remediation}</span>
          </span>
        </li>
      ))}
    </ol>
  </Card>
);

import { Card } from "@/components/ui/card";
import { Bug } from "lucide-react";
import { type Report } from "@/lib/compatibilityReport";

interface DebugTraceCardProps {
  trace: NonNullable<Report["trace"]>;
}

export const DebugTraceCard = ({ trace }: DebugTraceCardProps) => (
  <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <Bug className="h-4 w-4 text-primary" /> Debug trace ({trace.length} step(s))
    </h2>
    <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">
      {trace.map((t) => `+${t.at}ms  ${t.step}${
        t.detail !== undefined ? `  ${JSON.stringify(t.detail)}` : ""
      }`).join("\n")}
    </pre>
  </Card>
);

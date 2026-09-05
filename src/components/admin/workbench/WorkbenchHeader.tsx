import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Activity, Radio, Sparkles } from "lucide-react";

interface WorkbenchHeaderProps {
  selectedSourceCount: number;
  isAnalyzing: boolean;
  onAnalyzeSelected: () => void;
  onNavigate: (path: string) => void;
  onHealthCheck: () => void;
  ec2Loading: boolean;
}

/** Sticky admin workbench header with quick actions. */
export function WorkbenchHeader({
  selectedSourceCount,
  isAnalyzing,
  onAnalyzeSelected,
  onNavigate,
  onHealthCheck,
  ec2Loading,
}: WorkbenchHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 shadow-elegant backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-elegant"
            style={{ background: "var(--gradient-teal)" }}
          >
            <Radio className="h-4 w-4 text-primary-foreground" />
          </span>
          <h1
            className="min-w-0 break-words bg-clip-text text-base font-semibold text-transparent sm:truncate sm:text-lg"
            style={{ backgroundImage: "var(--gradient-teal)" }}
          >
            Admin workspace
          </h1>
          <Badge variant="outline" className="shrink-0 text-[11px]">
            admin
          </Badge>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {selectedSourceCount > 0 && (
            <Button
              onClick={onAnalyzeSelected}
              disabled={isAnalyzing}
              size="sm"
              className="gradient-primary shrink-0 whitespace-nowrap"
            >
              <Sparkles className="mr-1 h-4 w-4" />
              {isAnalyzing ? "Analyzing..." : `Analyze ${selectedSourceCount}`}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 whitespace-nowrap"
            onClick={() => onNavigate("/admin/semantic")}
          >
            <Radio className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">Analysis results</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onNavigate("/")}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Home
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onHealthCheck}
            disabled={ec2Loading}
            aria-label="EC2 health check"
          >
            <Activity className={`mr-1 h-4 w-4 ${ec2Loading ? "animate-pulse" : ""}`} />
            {ec2Loading ? "Checking..." : "EC2"}
          </Button>
        </div>
      </div>
    </header>
  );
}

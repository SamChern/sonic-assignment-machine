import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Radio, RefreshCw } from "lucide-react";
import sonicSimLogo from "@/assets/SonicSIM_blend.png";

interface SemanticAnalysisHeaderProps {
  navigate: (path: string) => void;
  loading: boolean;
  onRefresh: () => void;
}

export const SemanticAnalysisHeader = ({ navigate, loading, onRefresh }: SemanticAnalysisHeaderProps) => (
  <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 shadow-elegant backdrop-blur-md">
    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-elegant"
          style={{ background: "var(--gradient-teal)" }}
        >
          <Radio className="h-4 w-4 text-primary-foreground" />
        </span>
        <h1
          className="truncate bg-clip-text text-base font-semibold text-transparent sm:text-lg"
          style={{ backgroundImage: "var(--gradient-teal)" }}
        >
          SonicSIM Analysis Results
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <img
          src={sonicSimLogo}
          alt="SonicSIM.ai"
          width={1264}
          height={847}
          className="hidden h-6 w-auto max-w-[28vw] object-contain opacity-80 sm:block md:h-7"
          loading="lazy"
          decoding="async"
        />
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Admin
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/pipeline")}>
          Intuizi Console
        </Button>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>
    </div>
  </header>
);

export default SemanticAnalysisHeader;

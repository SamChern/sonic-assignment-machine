import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Brain, Users, Heart, MessageSquare, Music, MapPin } from "lucide-react";
import { NetworkVisualization } from "@/components/NetworkVisualization";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CategoryScore {
  name: string;
  score: number;
  description: string;
}

interface SourceAnalysis {
  name: string;
  categories: CategoryScore[];
}

interface AnalysisResultsProps {
  results: SourceAnalysis[] | null;
  isAnalyzing: boolean;
  sourceImages?: Array<{ name: string; imageUrl: string }>;
}

export const AnalysisResults = ({ results, isAnalyzing, sourceImages = [] }: AnalysisResultsProps) => {
  const [selectedSource, setSelectedSource] = useState<string>("all");
  
  if (isAnalyzing) {
    return (
      <Card className="p-8 shadow-elegant">
        <div className="space-y-4 text-center">
          <div className="flex justify-center">
            <div className="h-16 w-16 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          </div>
          <p className="text-lg font-semibold text-foreground">Processing semantic embeddings...</p>
          <p className="text-sm text-muted-foreground">
            Extracting features via hierarchical transformer and aligning modalities
          </p>
        </div>
      </Card>
    );
  }

  if (!results) return null;

  // Filter sources based on selection
  const filteredSources = selectedSource === "all" 
    ? results 
    : results.filter(source => source.name === selectedSource);

  const filteredImages = selectedSource === "all"
    ? sourceImages
    : sourceImages.filter(img => img.name === selectedSource);

  return (
    <div className="space-y-6">
      {/* Filter Controls */}
      {results.length > 1 && (
        <Card className="p-4 bg-card/80 backdrop-blur-sm shadow-elegant border-border/50">
          <div className="flex items-center gap-4">
            <label className="text-sm font-semibold text-foreground whitespace-nowrap">
              Filter by Source:
            </label>
            <Select value={selectedSource} onValueChange={setSelectedSource}>
              <SelectTrigger className="w-[300px] bg-background border-border">
                <SelectValue placeholder="Select a source" />
              </SelectTrigger>
              <SelectContent className="bg-background border-border z-50">
                <SelectItem value="all" className="cursor-pointer">
                  All Sources ({results.length})
                </SelectItem>
                {results.map((source) => (
                  <SelectItem key={source.name} value={source.name} className="cursor-pointer">
                    {source.name.length > 40 ? source.name.substring(0, 40) + '...' : source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedSource !== "all" && (
              <div className="text-xs text-muted-foreground">
                Viewing ontological fingerprint: <span className="font-semibold text-primary">{selectedSource}</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Network Visualization */}
      <NetworkVisualization sources={filteredSources} sourceImages={filteredImages} />

      {/* Detailed Results */}
      <Card className="p-8 shadow-elegant">
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Per-Source Semantic Analysis</h2>
            <p className="text-sm text-muted-foreground">
              Comparative ontological scoring showing how central each category is to each source's identity
            </p>
          </div>

          <div className="space-y-8">
            {filteredSources.map((source, sourceIndex) => (
              <div key={sourceIndex} className="space-y-4">
                <div className="flex items-center gap-3 pb-2 border-b border-border">
                  <h3 className="text-xl font-bold text-primary">{source.name}</h3>
                  <span className="text-xs text-muted-foreground">Ontological Fingerprint</span>
                </div>
                
                <div className="grid gap-4 md:grid-cols-2">
                  {source.categories.map((category, catIndex) => (
                    <div
                      key={catIndex}
                      className="group rounded-lg border border-border bg-card p-4 transition-smooth hover:border-primary/50 hover:shadow-glow"
                    >
                      <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary transition-smooth group-hover:bg-primary/20">
                          {getCategoryIcon(category.name)}
                        </div>
                        <div className="flex-1 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="font-semibold text-foreground">{category.name}</h4>
                            <span className="text-sm font-medium text-primary">
                              {category.score}%
                            </span>
                          </div>
                          <Progress value={category.score} className="h-2" />
                          <p className="text-sm text-muted-foreground">{category.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
};

// Icon mapping helper
export const getCategoryIcon = (categoryName: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    emotional: <Heart className="h-6 w-6" />,
    cognitive: <Brain className="h-6 w-6" />,
    social: <Users className="h-6 w-6" />,
    communication: <MessageSquare className="h-6 w-6" />,
    contextual: <MapPin className="h-6 w-6" />,
    artistic: <Music className="h-6 w-6" />,
  };
  
  return iconMap[categoryName.toLowerCase()] || <Brain className="h-6 w-6" />;
};
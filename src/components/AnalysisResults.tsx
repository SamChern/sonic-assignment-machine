import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Brain, Users, Heart, MessageSquare, Music } from "lucide-react";
import { NetworkVisualization } from "@/components/NetworkVisualization";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Category {
  name: string;
  confidence: number;
  description: string;
  icon: React.ReactNode;
  sources?: { name: string; type: string }[];
}

interface AnalysisResultsProps {
  results: Category[] | null;
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

  // Get all unique sources
  const allSources = new Set<string>();
  results.forEach(category => {
    category.sources?.forEach(source => {
      allSources.add(source.name);
    });
  });
  const uniqueSources = Array.from(allSources);

  // Filter categories based on selected source
  const filteredResults = selectedSource === "all" 
    ? results 
    : results.map(category => ({
        ...category,
        sources: category.sources?.filter(s => s.name === selectedSource) || []
      })).filter(category => category.sources && category.sources.length > 0);

  const filteredImages = selectedSource === "all"
    ? sourceImages
    : sourceImages.filter(img => img.name === selectedSource);

  return (
    <div className="space-y-6">
      {/* Filter Controls */}
      {uniqueSources.length > 1 && (
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
                  All Sources ({uniqueSources.length})
                </SelectItem>
                {uniqueSources.map((source) => (
                  <SelectItem key={source} value={source} className="cursor-pointer">
                    {source.length > 40 ? source.substring(0, 40) + '...' : source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedSource !== "all" && (
              <div className="text-xs text-muted-foreground">
                Viewing: <span className="font-semibold text-primary">{selectedSource}</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Network Visualization */}
      <NetworkVisualization categories={filteredResults} sourceImages={filteredImages} />

      {/* Detailed Results */}
      <Card className="p-8 shadow-elegant">
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Semantic Analysis Results</h2>
            <p className="text-sm text-muted-foreground">
              Audio-text similarity matrix with semantic consistency optimization via contrastive learning
            </p>
          </div>

          <div className="space-y-4">
            {filteredResults.map((category, index) => (
              <div
                key={index}
                className="group rounded-lg border border-border bg-card p-4 transition-smooth hover:border-primary/50 hover:shadow-glow"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary transition-smooth group-hover:bg-primary/20">
                    {category.icon}
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-foreground">{category.name}</h3>
                      <span className="text-sm font-medium text-primary">
                        {category.confidence}%
                      </span>
                    </div>
                    <Progress value={category.confidence} className="h-2" />
                    <p className="text-sm text-muted-foreground">{category.description}</p>
                    {category.sources && category.sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border">
                        <p className="text-xs text-muted-foreground/70 mb-1">
                          Detected in {category.sources.length} source{category.sources.length > 1 ? 's' : ''}:
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {category.sources.map((source, idx) => (
                            <span
                              key={idx}
                              className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
                            >
                              {source.name.length > 25 ? source.name.substring(0, 25) + '...' : source.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
};

// Default icon mapping helper
export const getCategoryIcon = (categoryName: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    emotional: <Heart className="h-6 w-6" />,
    cognitive: <Brain className="h-6 w-6" />,
    social: <Users className="h-6 w-6" />,
    communication: <MessageSquare className="h-6 w-6" />,
    contextual: <Brain className="h-6 w-6" />,
    artistic: <Music className="h-6 w-6" />,
  };
  
  return iconMap[categoryName.toLowerCase()] || <Brain className="h-6 w-6" />;
};

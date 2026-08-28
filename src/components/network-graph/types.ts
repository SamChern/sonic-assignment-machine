// Types shared between NetworkVisualization and its extracted panel
// components (CategoryLegend, NodeTooltip, SimilarityPanel).

export interface CategoryScore {
  name: string;
  score: number;
  description: string;
}

export interface SourceAnalysis {
  name: string;
  categories: CategoryScore[];
}

export interface CategorySimilarity {
  name: string;
  similarity: number;
  variance: number;
  interpretation: 'high' | 'moderate' | 'low';
}

export interface SourcePairSimilarity {
  source1: string;
  source2: string;
  similarity: number;
}

export interface SimilarityMetrics {
  overall: number;
  byCategory: CategorySimilarity[];
  sourcePairs: SourcePairSimilarity[];
  dominantCategory?: string;
  distinctiveCategory?: string;
}

export const CATEGORY_COLORS: Record<string, string> = {
  Emotional: 'hsl(200, 85%, 55%)',
  Cognitive: 'hsl(160, 75%, 50%)',
  Social: 'hsl(180, 80%, 60%)',
  Communication: 'hsl(140, 70%, 55%)',
  Contextual: 'hsl(220, 75%, 60%)',
  Artistic: 'hsl(170, 80%, 55%)',
};

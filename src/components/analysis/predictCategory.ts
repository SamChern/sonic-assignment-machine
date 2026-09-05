import type { CategoryScore } from "@/components/analysis/categoryStyles";

// Predict the dominant ontological category (argmax of the 6 scores).
// This is the post-hoc categorical label expressing how the audio relates
// to humans most strongly.
export const predictCategory = (categories: CategoryScore[]): CategoryScore | null => {
  if (!categories || categories.length === 0) return null;
  return categories.reduce((best, cur) => (cur.score > best.score ? cur : best));
};

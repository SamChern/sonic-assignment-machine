import type { CategoryKey } from "@/lib/enterpriseSchema";

export const SAMPLE_INPUT: Record<CategoryKey, number> = {
  emotional: 72,
  cognitive: 54,
  social: 61,
  communication: 78,
  contextual: 47,
  artistic: 66,
};

export type SideOption = { id: string; label: string };

/** Shared shape of the `analyze-audio` edge function response. */
export interface AnalyzeAudioCategory {
  name: string;
  score: number;
  description?: string;
}

export interface AnalyzeAudioSource {
  name: string;
  categories?: AnalyzeAudioCategory[];
  /** How much real audio backed the scores, when the pipeline reports it. */
  grounding_level?: "text-only" | "bridged" | "grounded";
  tags?: string[];
}

export interface AnalyzeAudioResponse {
  error?: string;
  /** Set when a guest hits the server-side free-run limit. */
  code?: string;
  /** Free runs left today for a signed-out visitor (null when signed in). */
  guest_runs_remaining?: number | null;
  guest_runs_limit?: number;
  sources?: AnalyzeAudioSource[];
}

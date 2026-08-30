/** Shared shape of the `analyze-audio` edge function response. */
export interface AnalyzeAudioCategory {
  name: string;
  score: number;
  description?: string;
}

export interface AnalyzeAudioSource {
  name: string;
  categories?: AnalyzeAudioCategory[];
}

export interface AnalyzeAudioResponse {
  error?: string;
  sources?: AnalyzeAudioSource[];
}

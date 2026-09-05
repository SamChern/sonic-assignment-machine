import { useState } from "react";
import { toast } from "sonner";
import { friendlyError } from '@/lib/friendlyError';
import { invokeWithTimeout } from "@/lib/invokeWithTimeout";
import type { AnalyzeAudioResponse } from "@/lib/analyzeAudio";
import { AudioSource } from "@/hooks/useAudioSources";

/**
 * Drives the analyze-audio call and the resulting filter/highlight state
 * consumed by the Understand tab.
 */
export function useHomeAnalysis(params: {
  userId: string | undefined;
  totalItems: number;
  selectedFiles: File[];
  spotifyTracks: any[];
  librarySources: AudioSource[];
  onComplete: () => void;
}) {
  const { userId, totalItems, selectedFiles, spotifyTracks, librarySources, onComplete } = params;

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{
    total: number;
    cached: number;
    fresh: number;
    status: 'idle' | 'checking-cache' | 'analyzing' | 'complete';
  } | null>(null);
  const [results, setResults] = useState<{ sources: any[]; images: any[]; musical?: any[] } | null>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const handleAnalyze = async () => {
    if (totalItems === 0) {
      toast.error("Please select at least one audio file or Spotify track");
      return;
    }

    setIsAnalyzing(true);
    setResults(null);
    setAnalysisProgress({
      total: totalItems,
      cached: 0,
      fresh: 0,
      status: 'checking-cache',
    });

    // Prepare sources for backend analysis (include spotify_id for caching)
    const sources = [
      ...selectedFiles.map(f => ({ name: f.name, type: 'file' as const })),
      ...spotifyTracks.map(t => ({
        name: `${t.name} - ${t.artists[0].name}`,
        type: 'track' as const,
        spotify_id: t.id, // Enable cache lookup by Spotify ID
        ...(t.audio_source_id ? { audio_source_id: t.audio_source_id } : {}),
      })),
      // Library rows already live in the backend: pass the id so the pipeline
      // reuses the stored audio, tags and cached features.
      ...librarySources.map(s2 => ({
        name: s2.name,
        type: (s2.source_type === 'spotify' ? 'track' : 'file') as 'track' | 'file',
        audio_source_id: s2.id,
        ...(s2.file_url ? { file_url: s2.file_url } : {}),
      })),
    ];

    const invokeAnalysis = async () => {
      // Bounded: a hung edge function must fail loudly rather than spin forever.
      const { data, error } = await invokeWithTimeout<AnalyzeAudioResponse>('analyze-audio', {
        body: {
          sources,
          user_id: userId,
          save_results: !!userId,
        },
      });

      if (error) {
        console.error('Analysis error:', error);
        throw new Error(error.message || 'Analysis failed');
      }

      // Check if backend returned an error in the response
      if (data?.error) {
        console.error('Backend error:', data.error);
        throw new Error(data.error);
      }

      if (!data || !data.sources) {
        console.error('Invalid response structure:', data);
        throw new Error('Invalid analysis response - no sources returned. Please try again.');
      }

      return data;
    };

    try {
      console.log('Sending sources for analysis:', sources);

      // Update to analyzing status
      setAnalysisProgress(prev => prev ? { ...prev, status: 'analyzing' } : null);

      let data;
      try {
        data = await invokeAnalysis();
      } catch (firstError) {
        // Retry once if the error looks like the JSON-parse issue
        const errMsg = firstError instanceof Error ? firstError.message : String(firstError);
        if (errMsg.includes('Failed to parse AI response')) {
          toast.info('AI response was malformed — retrying automatically…');
          data = await invokeAnalysis();
        } else {
          throw firstError;
        }
      }

      console.log('Received analysis:', data);

      // Update progress with cache stats from response
      const cacheStats = data.cache_stats || { cached: 0, fresh: data.sources?.length || 0 };
      setAnalysisProgress({
        total: totalItems,
        cached: cacheStats.cached,
        fresh: cacheStats.fresh,
        status: 'complete',
      });

      // Map backend results (per-source structure)
      const resultsWithIcons = data.sources;

      // Collect images from Spotify tracks for visualization
      const imageData = spotifyTracks
        .filter(track => track.album.images && track.album.images.length > 0)
        .map(track => ({
          name: `${track.name} - ${track.artists[0].name}`,
          imageUrl: track.album.images[0].url
        }));

      setResults({ sources: resultsWithIcons, images: imageData, musical: data.musical ?? [] });
      setIsAnalyzing(false);
      onComplete(); // Switch to network tab after analysis

      // Show detailed success message
      const cachedMsg = cacheStats.cached > 0 ? ` (${cacheStats.cached} cached, ${cacheStats.fresh} analyzed)` : '';
      toast.success(`Semantic analysis complete for ${totalItems} source${totalItems > 1 ? 's' : ''}${cachedMsg}!`);
    } catch (error) {
      console.error('Analysis error:', error);
      setIsAnalyzing(false);
      setAnalysisProgress(null);
      toast.error(friendlyError(error, 'We couldn\'t finish that analysis. Please try again.'));
    }
  };

  // Filter sources based on selection
  const filteredSources = selectedSources.length === 0
    ? results?.sources || []
    : (results?.sources || []).filter((source: any) => {
        const cleanSourceName = source.name.trim();
        return selectedSources.some(selected => selected.trim() === cleanSourceName);
      });

  const filteredImages = selectedSources.length === 0
    ? results?.images || []
    : (results?.images || []).filter((img: any) =>
        selectedSources.some(selected => selected.trim() === img.name.trim())
      );

  const toggleSource = (sourceName: string) => {
    setSelectedSources(prev =>
      prev.includes(sourceName)
        ? prev.filter(s => s !== sourceName)
        : [...prev, sourceName]
    );
  };

  const clearAllFilters = () => {
    setSelectedSources([]);
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const clearCategoryFilters = () => {
    setSelectedCategories([]);
  };

  return {
    isAnalyzing,
    analysisProgress,
    results,
    selectedSources,
    selectedCategories,
    handleAnalyze,
    filteredSources,
    filteredImages,
    toggleSource,
    clearAllFilters,
    toggleCategory,
    clearCategoryFilters,
  };
}

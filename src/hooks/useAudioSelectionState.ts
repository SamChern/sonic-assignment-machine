import { useState } from "react";
import { toast } from "sonner";
import { useAudioSources, AudioSource } from "@/hooks/useAudioSources";

/**
 * Owns the "what's queued for analysis" state for the home page: selected
 * files, Spotify tracks and library picks, plus the add/remove handlers the
 * Listen tab drives.
 */
export function useAudioSelectionState(params: {
  isSignedIn: boolean;
  onAdded: () => void;
}) {
  const { isSignedIn, onAdded } = params;
  const { saveSpotifyTrack, saveFileSource } = useAudioSources();

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [spotifyTracks, setSpotifyTracks] = useState<any[]>([]);
  // Library picks that are not Spotify rows (uploads, CTV/Intuizi signals, …).
  // They used to be dropped on the floor: "Added N sources" toasted, nothing
  // selected. They now carry their audio_source_id straight into analysis.
  const [librarySources, setLibrarySources] = useState<AudioSource[]>([]);

  const handleFileSelect = (file: File) => {
    setSelectedFiles(prev => [...prev, file]);
    toast.success(`Added: ${file.name}`);
    // Optionally save to library
    if (isSignedIn) {
      saveFileSource(file);
    }
  };

  const handleSpotifyTrack = (track: any) => {
    if (spotifyTracks.find(t => t.id === track.id)) {
      toast.info("Track already added");
      return;
    }
    setSpotifyTracks(prev => [...prev, track]);
    toast.success(`Added: ${track.name} by ${track.artists.map((a: any) => a.name).join(", ")}`);
    // Optionally save to library
    if (isSignedIn) {
      saveSpotifyTrack(track);
    }
  };

  const handleLibrarySelect = (sources: AudioSource[]) => {
    let added = 0;
    const nextLibrary: AudioSource[] = [];
    sources.forEach(source => {
      if (source.source_type === 'spotify') {
        // Convert to track format for analysis
        const mockTrack = {
          id: source.spotify_id || source.id,
          name: source.name.split(' - ')[0],
          artists: (source.artists || []).map(name => ({ name })),
          album: {
            name: source.album_name || '',
            images: source.album_image ? [{ url: source.album_image }] : [],
          },
          external_urls: { spotify: source.spotify_url },
          preview_url: source.preview_url,
          audio_source_id: source.id,
        };
        if (!spotifyTracks.find(t => t.id === mockTrack.id)) {
          setSpotifyTracks(prev =>
            prev.find(t => t.id === mockTrack.id) ? prev : [...prev, mockTrack],
          );
          added += 1;
        }
        return;
      }
      // Every other library row (file upload, CTV/Intuizi signal, ingested
      // source) is selectable too — analysis reuses the stored audio.
      const alreadySelected =
        librarySources.some(s2 => s2.id === source.id) ||
        nextLibrary.some(s2 => s2.id === source.id);
      if (!alreadySelected) {
        nextLibrary.push(source);
        added += 1;
      }
    });

    if (nextLibrary.length) {
      setLibrarySources(prev => {
        const seen = new Set(prev.map(s2 => s2.id));
        return [...prev, ...nextLibrary.filter(s2 => !seen.has(s2.id))];
      });
    }

    if (added === 0) {
      toast.info(
        sources.length === 1 ? 'Already selected' : 'Those sources are already selected',
      );
    } else {
      toast.success(`Added ${added} source${added > 1 ? 's' : ''} to analysis`);
    }
    onAdded();
  };

  const removeLibrarySource = (id: string) => {
    setLibrarySources(prev => prev.filter(s2 => s2.id !== id));
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeTrack = (id: string) => {
    setSpotifyTracks(prev => prev.filter(t => t.id !== id));
  };

  const totalItems = selectedFiles.length + spotifyTracks.length + librarySources.length;

  const clearAll = () => {
    setSelectedFiles([]);
    setSpotifyTracks([]);
    setLibrarySources([]);
  };

  return {
    selectedFiles,
    spotifyTracks,
    librarySources,
    totalItems,
    handleFileSelect,
    handleSpotifyTrack,
    handleLibrarySelect,
    removeLibrarySource,
    removeFile,
    removeTrack,
    clearAll,
  };
}

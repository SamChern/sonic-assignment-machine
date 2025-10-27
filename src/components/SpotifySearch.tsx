import { useState } from "react";
import { Search, Music, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  album: {
    name: string;
    images: { url: string }[];
  };
  preview_url: string | null;
  external_urls: {
    spotify: string;
  };
}

interface SpotifySearchProps {
  onTrackSelect: (track: SpotifyTrack) => void;
}

export const SpotifySearch = ({ onTrackSelect }: SpotifySearchProps) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpotifyTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!query.trim()) {
      toast.error("Please enter a search term");
      return;
    }

    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('spotify-search', {
        body: { query, type: 'track' }
      });

      if (error) throw error;

      setResults(data.tracks?.items || []);
      if (data.tracks?.items?.length === 0) {
        toast.info("No tracks found");
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error("Failed to search Spotify");
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          type="text"
          placeholder="Search for songs or artists..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={isSearching}
          className="gradient-primary shadow-elegant"
        >
          <Search className="h-4 w-4 mr-2" />
          {isSearching ? "Searching..." : "Search"}
        </Button>
      </form>

      {results.length > 0 && (
        <div className="grid gap-3 max-h-96 overflow-y-auto">
          {results.map((track) => (
            <Card
              key={track.id}
              className="p-4 hover:border-primary/50 transition-smooth cursor-pointer"
              onClick={() => onTrackSelect(track)}
            >
              <div className="flex gap-4 items-center">
                {track.album.images[0] && (
                  <img
                    src={track.album.images[0].url}
                    alt={track.album.name}
                    className="w-16 h-16 rounded"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Music className="h-4 w-4 text-primary flex-shrink-0" />
                    <h3 className="font-semibold text-foreground truncate">
                      {track.name}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {track.artists.map(a => a.name).join(", ")}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {track.album.name}
                  </p>
                </div>
                <a
                  href={track.external_urls.spotify}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-primary hover:text-primary/80"
                >
                  <ExternalLink className="h-5 w-5" />
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

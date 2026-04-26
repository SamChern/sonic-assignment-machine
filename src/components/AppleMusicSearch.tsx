import { useState } from "react";
import { Search, Music, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AppleTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  album: {
    name: string;
    images: { url: string }[];
  };
  preview_url: string | null;
  external_urls: { spotify: string };
}

interface AppleMusicSearchProps {
  onTrackSelect: (track: AppleTrack) => void;
}

export const AppleMusicSearch = ({ onTrackSelect }: AppleMusicSearchProps) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AppleTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      toast.error("Please enter a search term");
      return;
    }

    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke("apple-music-search", {
        body: { query, type: "songs" },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        setResults([]);
        return;
      }
      setResults(data?.tracks?.items ?? []);
    } catch (err) {
      console.error("Apple Music search error:", err);
      toast.error("Apple Music search failed");
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          type="text"
          placeholder="Search Apple Music for tracks..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={isSearching}>
          <Search className="h-4 w-4 mr-2" />
          {isSearching ? "Searching..." : "Search"}
        </Button>
      </form>

      {results.length > 0 && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {results.map((track) => (
            <Card
              key={track.id}
              className="p-3 flex items-center gap-3 hover:bg-accent/50 cursor-pointer transition-smooth"
              onClick={() => onTrackSelect(track)}
            >
              {track.album.images[0] ? (
                <img
                  src={track.album.images[0].url}
                  alt={track.album.name}
                  className="h-12 w-12 rounded object-cover flex-shrink-0"
                />
              ) : (
                <div className="h-12 w-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
                  <Music className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{track.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {track.artists.map((a) => a.name).join(", ")}
                </p>
              </div>
              {track.external_urls.spotify && (
                <a
                  href={track.external_urls.spotify}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

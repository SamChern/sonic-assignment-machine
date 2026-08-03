import { useState, useEffect, useRef, ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAudioSources, AudioSource } from '@/hooks/useAudioSources';
import { useAuth } from '@/hooks/useAuth';
import { Music, FileAudio, Trash2, User, Globe, Library, Plus, ExternalLink } from 'lucide-react';

interface UserLibraryProps {
  onSelectSource?: (source: AudioSource) => void;
  onSelectMultiple?: (sources: AudioSource[]) => void;
}

const PAGE_SIZE = 40;

// Windowed grid: renders sources in chunks and grows as the sentinel scrolls
// into view, so libraries with thousands of items stay cheap to render.
function LazySourceGrid({
  sources,
  renderItem,
}: {
  sources: AudioSource[];
  renderItem: (source: AudioSource) => ReactNode;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [sources.length]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || visible >= sources.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        setVisible(v => Math.min(v + PAGE_SIZE, sources.length));
      }
    }, { rootMargin: '300px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, sources.length]);

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.slice(0, visible).map(renderItem)}
      </div>
      {visible < sources.length && (
        <div ref={sentinelRef} className="py-3 text-center text-xs text-muted-foreground">
          Loading more… ({visible} of {sources.length})
        </div>
      )}
    </>
  );
}

export function UserLibrary({ onSelectSource, onSelectMultiple }: UserLibraryProps) {
  const { user } = useAuth();
  const { mySources, allSources, loading, deleteSource } = useAudioSources();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAnalyzeSelected = () => {
    if (onSelectMultiple) {
      const sources = allSources.filter(s => selectedIds.has(s.id));
      onSelectMultiple(sources);
      setSelectedIds(new Set());
    }
  };

  const groupByUser = (sources: AudioSource[]) => {
    const grouped: Record<string, { profile: any; sources: AudioSource[] }> = {};
    sources.forEach(source => {
      const userId = source.user_id;
      if (!grouped[userId]) {
        grouped[userId] = {
          profile: source.profile || { username: 'Anonymous', avatar_url: null },
          sources: [],
        };
      }
      grouped[userId].sources.push(source);
    });
    return Object.entries(grouped);
  };

  if (loading) {
    return (
      <Card className="p-8">
        <div className="flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        </div>
      </Card>
    );
  }

  const SourceCard = ({ source, showDelete = false }: { source: AudioSource; showDelete?: boolean }) => {
    const isSelected = selectedIds.has(source.id);
    
    return (
      <Card 
        className={`p-3 transition-all cursor-pointer ${
          isSelected 
            ? 'ring-2 ring-primary bg-primary/10' 
            : 'bg-secondary/20 hover:bg-secondary/30'
        }`}
        onClick={() => toggleSelect(source.id)}
      >
        <div className="flex gap-3 items-center">
          {source.source_type === 'spotify' && source.album_image ? (
            <img
              src={source.album_image}
              alt={source.album_name || ''}
              className="w-10 h-10 rounded flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded bg-secondary flex items-center justify-center flex-shrink-0">
              {source.source_type === 'spotify' ? (
                <Music className="h-5 w-5 text-primary" />
              ) : (
                <FileAudio className="h-5 w-5 text-primary" />
              )}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground text-sm truncate">{source.name}</p>
            {source.artists && source.artists.length > 0 && (
              <p className="text-xs text-muted-foreground truncate">
                {source.artists.join(', ')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {source.spotify_url && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(source.spotify_url, '_blank');
                }}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
            {showDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSource(source.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue={user ? "my-library" : "browse"} className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            {user && (
              <TabsTrigger value="my-library" className="flex items-center gap-2">
                <Library className="h-4 w-4" />
                My Library ({mySources.length})
              </TabsTrigger>
            )}
            <TabsTrigger value="browse" className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Browse All ({allSources.length})
            </TabsTrigger>
          </TabsList>
          
          {selectedIds.size > 0 && onSelectMultiple && (
            <Button onClick={handleAnalyzeSelected} className="gap-2">
              <Plus className="h-4 w-4" />
              Add {selectedIds.size} to Analysis
            </Button>
          )}
        </div>

        {user && (
          <TabsContent value="my-library" className="space-y-3">
            {mySources.length === 0 ? (
              <Card className="p-6 text-center">
                <Library className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">Your library is empty</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Search Spotify or upload files to add sources
                </p>
              </Card>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {mySources.map(source => (
                  <SourceCard key={source.id} source={source} showDelete />
                ))}
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="browse" className="space-y-4">
          {allSources.length === 0 ? (
            <Card className="p-6 text-center">
              <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No public sources yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Be the first to add audio sources!
              </p>
            </Card>
          ) : (
            groupByUser(allSources).map(([userId, { profile, sources }]) => (
              <Card key={userId} className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={profile?.avatar_url || undefined} />
                    <AvatarFallback>
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <span className="font-medium text-foreground">
                    {profile?.username || 'Anonymous'}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {sources.length} source{sources.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {sources.map(source => (
                    <SourceCard 
                      key={source.id} 
                      source={source} 
                      showDelete={user?.id === source.user_id} 
                    />
                  ))}
                </div>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

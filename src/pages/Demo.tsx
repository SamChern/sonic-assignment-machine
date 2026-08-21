import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Contrast, Download, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import highlightVideo from "@/assets/sonicsim-highlight.mp4.asset.json";


type CaptionStyle = "high-contrast" | "minimal";

const SOURCES: Record<CaptionStyle, string> = {
  "high-contrast": "/demo/sonicsim-demo-high-contrast.mp4",
  minimal: "/demo/sonicsim-demo-minimal.mp4",
};

const STORAGE_KEY = "sonicsim-caption-style";

const Demo = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [style, setStyle] = useState<CaptionStyle>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "minimal" ? "minimal" : "high-contrast";
  });

  // Swap the burned-in caption variant while preserving playback position/state.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const time = video.currentTime;
    const wasPlaying = !video.paused && !video.ended;

    video.src = SOURCES[style];
    video.load();

    const restore = () => {
      video.currentTime = time;
      if (wasPlaying) void video.play();
      video.removeEventListener("loadedmetadata", restore);
    };
    video.addEventListener("loadedmetadata", restore);
    localStorage.setItem(STORAGE_KEY, style);

    return () => video.removeEventListener("loadedmetadata", restore);
  }, [style]);

  const highContrast = style === "high-contrast";

  return (
    <main className="container mx-auto max-w-5xl px-4 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-6">
        <Link to="/">
          <ArrowLeft />
          <span>Back</span>
        </Link>
      </Button>

      <h1 className="text-3xl font-semibold tracking-tight">Product demo</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        A 50-second highlight reel of the live app, plus the full walkthrough
        with step-by-step captions.
      </p>

      <Card className="mt-6 overflow-hidden border-primary/30 bg-card/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold tracking-tight">
              Highlight reel — the sonic semantic layer in 50 seconds
            </h2>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={highlightVideo.url} download="sonicsim-highlight.mp4">
              <Download />
              <span>Download MP4</span>
            </a>
          </Button>
        </div>
        <div className="aspect-video overflow-hidden rounded-md bg-background">
          <video
            className="size-full"
            controls
            playsInline
            preload="metadata"
            src={highlightVideo.url}
            aria-label="SonicSIM highlight reel with on-screen supers"
          />
        </div>
      </Card>

      <h2 className="mt-10 text-lg font-semibold tracking-tight">
        Full walkthrough
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Caption timing and wording are identical in both styles — only the
        visual treatment changes.
      </p>

      <Card className="mt-4 overflow-hidden border-border/60 bg-card/60 p-3">
        <div className="aspect-video overflow-hidden rounded-md bg-background">

          <video
            ref={videoRef}
            className="size-full"
            controls
            playsInline
            preload="metadata"
            aria-label="SonicSIM product demo with burned-in step captions"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 px-1 pb-1">
          <div className="flex items-center gap-3">
            <Contrast className="size-4 text-muted-foreground" aria-hidden="true" />
            <div className="flex items-center gap-3">
              <Switch
                id="caption-contrast"
                checked={highContrast}
                onCheckedChange={(checked) =>
                  setStyle(checked ? "high-contrast" : "minimal")
                }
                aria-describedby="caption-contrast-help"
              />
              <Label htmlFor="caption-contrast" className="cursor-pointer">
                High-contrast caption bubbles
              </Label>
            </div>
          </div>
          <p
            id="caption-contrast-help"
            className="text-sm text-muted-foreground"
          >
            {highContrast
              ? "Solid bubble background for maximum legibility."
              : "Translucent bubble that blends with the interface."}
          </p>
        </div>
      </Card>

      <p aria-live="polite" className="sr-only">
        {highContrast
          ? "High-contrast caption bubbles enabled."
          : "Minimal caption bubbles enabled."}
      </p>
    </main>
  );
};

export default Demo;

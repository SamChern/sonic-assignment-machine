import { useMemo } from "react";

interface WaveformBackgroundProps {
  variant?: "full" | "lockup";
}

export function WaveformBackground({ variant = "full" }: WaveformBackgroundProps) {
  const bars = useMemo(() => {
    return Array.from({ length: 64 }, (_, i) => {
      const base = Math.sin(i * 0.5) * 0.5 + 0.5;
      const ripple = Math.cos(i * 1.2) * 0.25;
      const noise = Math.random() * 0.15;
      return 20 + (base + ripple + noise) * 60;
    });
  }, []);

  if (variant === "lockup") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none z-0">
        <svg
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="none"
          viewBox="0 0 1000 100"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {bars.map((height, i) => {
            const x = (i / 64) * 1000;
            const width = 14;
            const y = (100 - height) / 2;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={width}
                height={height}
                rx="2"
                fill="hsl(0 0% 14%)"
              />
            );
          })}
        </svg>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      <svg
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="none"
        viewBox="0 0 1000 100"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {bars.map((height, i) => {
          const x = (i / 64) * 1000;
          const width = 14;
          const y = (100 - height) / 2;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={width}
              height={height}
              rx="2"
              fill="hsl(0 0% 11%)"
            />
          );
        })}
      </svg>
      {/* Top fade to background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
    </div>
  );
}

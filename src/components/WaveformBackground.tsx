import { useMemo } from "react";

export function WaveformBackground() {
  const bars = useMemo(() => {
    return Array.from({ length: 64 }, (_, i) => {
      const base = Math.sin(i * 0.5) * 0.5 + 0.5;
      const ripple = Math.cos(i * 1.2) * 0.25;
      const noise = Math.random() * 0.15;
      // Extended by 15% (60 -> 69)
      return 20 + (base + ripple + noise) * 69;
    });
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      <svg
        className="absolute w-full h-[140%] -top-[20%]"
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
      {/* Subtle bottom fade so the waveform blends into content below */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}

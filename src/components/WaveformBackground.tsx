export function WaveformBackground() {
  // Generate 80 vertical bars with pseudo-random heights for an organic waveform look
  const bars = Array.from({ length: 80 }, (_, i) => {
    const height = 15 + Math.sin(i * 0.35) * 10 + Math.cos(i * 0.8) * 8 + Math.random() * 12;
    return Math.max(5, Math.min(45, height));
  });

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      <div className="absolute inset-0 flex items-end justify-between gap-px px-4">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm"
            style={{
              height: `${h}%`,
              backgroundColor: "hsl(0 0% 11%)",
              opacity: 0.85,
              minWidth: 2,
            }}
          />
        ))}
      </div>
      {/* Subtle top gradient to fade waveform into page background */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to bottom, hsl(0 0% 5%) 0%, transparent 40%)",
        }}
      />
    </div>
  );
}

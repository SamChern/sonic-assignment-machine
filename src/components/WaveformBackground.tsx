export function WaveformBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      <svg
        className="absolute bottom-0 left-0 w-full h-full"
        preserveAspectRatio="none"
        viewBox="0 0 1440 600"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Wave 1 */}
        <path
          d="M0,300 C240,360 480,240 720,300 C960,360 1200,240 1440,300 L1440,600 L0,600 Z"
          fill="hsl(0 0% 12%)"
          opacity="0.9"
        />
        {/* Wave 2 */}
        <path
          d="M0,380 C320,320 640,440 960,380 C1120,350 1280,400 1440,380 L1440,600 L0,600 Z"
          fill="hsl(0 0% 10%)"
          opacity="0.95"
        />
        {/* Wave 3 */}
        <path
          d="M0,460 C180,420 360,500 540,460 C720,420 900,500 1080,460 C1260,420 1350,480 1440,460 L1440,600 L0,600 Z"
          fill="hsl(0 0% 14%)"
          opacity="0.85"
        />
      </svg>
    </div>
  );
}

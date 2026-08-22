import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Heart, Brain, Users, MessageCircle, Map, Palette } from "lucide-react";
import fingerprintBg from "@/assets/fingerprint-bg.webp";

interface UserFingerprint {
  user_id: string;
  username?: string;
  avatar_url?: string;
  emotional_avg: number;
  cognitive_avg: number;
  social_avg: number;
  communication_avg: number;
  contextual_avg: number;
  artistic_avg: number;
  total_sources_analyzed: number;
}

interface FingerprintVisualizationProps {
  fingerprint: UserFingerprint;
  size?: "sm" | "md" | "lg";
  showLabels?: boolean;
}

const categories = [
  { key: "emotional_avg", name: "Emotional", color: "hsl(0, 70%, 60%)", icon: Heart },
  { key: "cognitive_avg", name: "Cognitive", color: "hsl(210, 70%, 60%)", icon: Brain },
  { key: "social_avg", name: "Social", color: "hsl(120, 50%, 50%)", icon: Users },
  { key: "communication_avg", name: "Communication", color: "hsl(45, 80%, 55%)", icon: MessageCircle },
  { key: "contextual_avg", name: "Contextual", color: "hsl(280, 60%, 60%)", icon: Map },
  { key: "artistic_avg", name: "Artistic", color: "hsl(330, 70%, 60%)", icon: Palette },
];

export const FingerprintVisualization = ({ 
  fingerprint, 
  size = "md",
  showLabels = true 
}: FingerprintVisualizationProps) => {
  const dimensions = {
    sm: { width: 200, height: 200, labelOffset: 25 },
    md: { width: 300, height: 300, labelOffset: 35 },
    lg: { width: 400, height: 400, labelOffset: 45 },
  };

  const { width, height, labelOffset } = dimensions[size];
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) / 2 - labelOffset - 10;

  const points = useMemo(() => {
    return categories.map((cat, i) => {
      const angle = (Math.PI * 2 * i) / categories.length - Math.PI / 2;
      const value = Number(fingerprint[cat.key as keyof UserFingerprint]) || 0;
      const radius = (value / 100) * maxRadius;
      return {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        labelX: centerX + (maxRadius + labelOffset) * Math.cos(angle),
        labelY: centerY + (maxRadius + labelOffset) * Math.sin(angle),
        value,
        ...cat,
      };
    });
  }, [fingerprint, centerX, centerY, maxRadius, labelOffset]);

  const polygonPath = points.map((p, i) => 
    `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
  ).join(' ') + ' Z';

  // Background grid circles
  const gridCircles = [20, 40, 60, 80, 100];

  return (
    <div className="relative">
      {/* Fingerprint background image */}
      <div 
        className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10"
        style={{ 
          width, 
          height,
          margin: '0 auto'
        }}
      >
        <img 
          src={fingerprintBg} 
          alt="" 
          className="w-full h-full object-contain"
          style={{ filter: 'grayscale(100%)' }}
        />
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="mx-auto relative max-w-full h-auto"
      >
        {/* Grid circles */}
        {gridCircles.map((percent) => (
          <circle
            key={percent}
            cx={centerX}
            cy={centerY}
            r={(percent / 100) * maxRadius}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={percent === 100 ? 1.5 : 0.5}
            strokeDasharray={percent === 100 ? "none" : "4 4"}
            opacity={0.5}
          />
        ))}

        {/* Axis lines */}
        {points.map((p, i) => {
          const angle = (Math.PI * 2 * i) / categories.length - Math.PI / 2;
          return (
            <line
              key={`axis-${i}`}
              x1={centerX}
              y1={centerY}
              x2={centerX + maxRadius * Math.cos(angle)}
              y2={centerY + maxRadius * Math.sin(angle)}
              stroke="hsl(var(--border))"
              strokeWidth={0.5}
              opacity={0.5}
            />
          );
        })}

        {/* Filled polygon */}
        <path
          d={polygonPath}
          fill="hsl(var(--primary) / 0.2)"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
        />

        {/* Data points */}
        {points.map((p, i) => (
          <g key={`point-${i}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={size === "sm" ? 4 : 6}
              fill={p.color}
              stroke="hsl(var(--background))"
              strokeWidth={2}
            />
            {showLabels && (
              <text
                x={p.labelX}
                y={p.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground text-xs font-medium"
              >
                {p.name}
              </text>
            )}
          </g>
        ))}

        {/* Center score */}
        <text
          x={centerX}
          y={centerY - 8}
          textAnchor="middle"
          className="fill-foreground text-lg font-bold"
        >
          {fingerprint.total_sources_analyzed}
        </text>
        <text
          x={centerX}
          y={centerY + 10}
          textAnchor="middle"
          className="fill-muted-foreground text-xs"
        >
          sources
        </text>
      </svg>

      {/* Legend */}
      {showLabels && size !== "sm" && (
        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          {points.map((p) => (
            <div key={p.key} className="flex items-center gap-1">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: p.color }}
              />
              <span className="text-muted-foreground">{p.name}:</span>
              <span className="font-medium text-foreground">{p.value.toFixed(0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Compact fingerprint badge for list views
export const FingerprintBadge = ({ fingerprint }: { fingerprint: UserFingerprint }) => {
  const dominant = useMemo(() => {
    let maxKey = "emotional_avg";
    let maxVal = 0;
    categories.forEach(cat => {
      const val = Number(fingerprint[cat.key as keyof UserFingerprint]) || 0;
      if (val > maxVal) {
        maxVal = val;
        maxKey = cat.key;
      }
    });
    return categories.find(c => c.key === maxKey)!;
  }, [fingerprint]);

  const Icon = dominant.icon;

  return (
    <div 
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium"
      style={{ backgroundColor: `${dominant.color}20`, color: dominant.color }}
    >
      <Icon className="h-3 w-3" />
      <span>{dominant.name}</span>
      <span className="opacity-70">({fingerprint.total_sources_analyzed})</span>
    </div>
  );
};

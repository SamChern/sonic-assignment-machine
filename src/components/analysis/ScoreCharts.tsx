import { cn } from "@/lib/utils";
import { getCategoryStyles, type CategoryScore } from "@/components/analysis/categoryStyles";

// Radial score visualization component
export const RadialScoreChart = ({ categories }: { categories: CategoryScore[] }) => {
  const size = 180;
  const center = size / 2;
  const maxRadius = 70;
  const minRadius = 20;

  const angleStep = (2 * Math.PI) / categories.length;

  const points = categories.map((cat, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const radius = minRadius + (cat.score / 100) * (maxRadius - minRadius);
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
      score: cat.score,
      name: cat.name,
    };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ") + " Z";

  return (
    <svg width={size} height={size} className="drop-shadow-lg">
      {/* Background circles */}
      {[25, 50, 75, 100].map((pct) => (
        <circle
          key={pct}
          cx={center}
          cy={center}
          r={minRadius + (pct / 100) * (maxRadius - minRadius)}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth="1"
          opacity="0.3"
        />
      ))}
      
      {/* Axis lines */}
      {categories.map((_, i) => {
        const angle = i * angleStep - Math.PI / 2;
        return (
          <line
            key={i}
            x1={center}
            y1={center}
            x2={center + maxRadius * Math.cos(angle)}
            y2={center + maxRadius * Math.sin(angle)}
            stroke="hsl(var(--border))"
            strokeWidth="1"
            opacity="0.3"
          />
        );
      })}

      {/* Score polygon */}
      <path
        d={pathD}
        fill="hsl(var(--primary) / 0.2)"
        stroke="hsl(var(--primary))"
        strokeWidth="2"
        className="animate-[scale-in_0.5s_ease-out]"
      />

      {/* Score points */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="4"
          fill="hsl(var(--primary))"
          className="animate-[scale-in_0.3s_ease-out]"
          style={{ animationDelay: `${i * 0.1}s` }}
        />
      ))}

      {/* Category labels */}
      {categories.map((cat, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const labelRadius = maxRadius + 18;
        const x = center + labelRadius * Math.cos(angle);
        const y = center + labelRadius * Math.sin(angle);
        const styles = getCategoryStyles(cat.name);
        
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            className={cn("text-[10px] font-medium fill-current", styles.text)}
          >
            {cat.name.slice(0, 4)}
          </text>
        );
      })}
    </svg>
  );
};

// Animated score bar component
export const AnimatedScoreBar = ({ score, categoryName, delay }: { score: number; categoryName: string; delay: number }) => {
  const styles = getCategoryStyles(categoryName);
  
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "absolute left-0 top-0 h-full rounded-full transition-all duration-1000 ease-out",
          styles.text.replace("text-", "bg-")
        )}
        style={{
          width: `${score}%`,
          animation: `slideIn 0.8s ease-out ${delay}s both`,
        }}
      />
    </div>
  );
};

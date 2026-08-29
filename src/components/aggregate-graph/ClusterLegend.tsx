import { Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Cluster } from "@/components/graph/adapters/aggregate";

/** Floating cluster key over the aggregate canvas; hover syncs with the graph. */
export const ClusterLegend = ({
  clusters,
  hoveredCluster,
  onHoverCluster,
}: {
  clusters: Cluster[];
  hoveredCluster: Cluster | null;
  onHoverCluster: (cluster: Cluster | null) => void;
}) => {
  if (clusters.length === 0) return null;

  return (
    <div className="absolute top-4 right-4 z-10 bg-card/95 backdrop-blur-sm rounded-xl p-4 border border-border/50 shadow-lg min-w-[180px]">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border/30">
        <Layers className="h-4 w-4 text-primary" />
        <span className="text-sm font-bold text-foreground">Clusters</span>
      </div>
      <div className="space-y-2">
        {clusters.map((cluster) => {
          const Icon = cluster.dominantCategory.icon;
          return (
            <div
              key={cluster.id}
              className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all duration-200 ${
                hoveredCluster?.id === cluster.id ? "bg-primary/10 scale-105" : "hover:bg-muted/50"
              }`}
              onMouseEnter={() => onHoverCluster(cluster)}
              onMouseLeave={() => onHoverCluster(null)}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center shadow-md"
                style={{ backgroundColor: cluster.color, boxShadow: `0 0 10px ${cluster.color}60` }}
              >
                <Icon className="h-3 w-3 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-foreground truncate">{cluster.label}</div>
              </div>
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0.5 font-bold"
                style={{
                  backgroundColor: `${cluster.color}20`,
                  color: cluster.color,
                  borderColor: cluster.color,
                }}
              >
                {cluster.members.length}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
};

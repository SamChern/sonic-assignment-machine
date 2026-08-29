import { Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CATEGORY_AXES, type Cluster } from "@/components/graph/adapters/aggregate";

/** Per-cluster centroid profile plus member avatars. */
export const ClusterAnalysisCards = ({ clusters }: { clusters: Cluster[] }) => {
  if (clusters.length === 0) return null;

  return (
    <Card className="p-6 bg-card/80">
      <div className="flex items-center gap-2 mb-4">
        <Layers className="h-5 w-5 text-primary" />
        <h4 className="font-semibold text-foreground">Community Clusters</h4>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {clusters.map((cluster) => {
          const Icon = cluster.dominantCategory.icon;
          return (
            <div
              key={cluster.id}
              className="p-4 rounded-lg border-2 transition-colors"
              style={{ borderColor: cluster.color, backgroundColor: `${cluster.color}08` }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="p-2 rounded-full" style={{ backgroundColor: `${cluster.color}20` }}>
                  <Icon className="h-4 w-4" style={{ color: cluster.color }} />
                </div>
                <div>
                  <p className="font-medium text-foreground">{cluster.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {cluster.members.length} member{cluster.members.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              <div className="space-y-1 mb-3">
                {CATEGORY_AXES.map((cat, idx) => (
                  <div key={cat.key} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground w-20 truncate">{cat.name}</span>
                    <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${cluster.centroid[idx]}%`, backgroundColor: cat.color }}
                      />
                    </div>
                    <span className="font-medium w-6 text-right">
                      {cluster.centroid[idx].toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-1">
                {cluster.members.slice(0, 6).map((member) => (
                  <Avatar
                    key={member.user_id}
                    className="h-6 w-6 border-2"
                    style={{ borderColor: cluster.color }}
                  >
                    <AvatarImage src={member.avatar_url || undefined} />
                    <AvatarFallback className="text-[10px]">
                      {member.username?.charAt(0).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {cluster.members.length > 6 && (
                  <div
                    className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-medium"
                    style={{ backgroundColor: `${cluster.color}20`, color: cluster.color }}
                  >
                    +{cluster.members.length - 6}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

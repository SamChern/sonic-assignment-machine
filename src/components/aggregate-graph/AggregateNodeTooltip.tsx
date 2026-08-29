import { User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  CATEGORY_AXES,
  type Cluster,
  type UserFingerprint,
} from "@/components/graph/adapters/aggregate";

/** Cursor-following readout for the hovered user node. */
export const AggregateNodeTooltip = ({
  user,
  cluster,
  position,
}: {
  user: UserFingerprint;
  cluster: Cluster | null;
  position: { x: number; y: number };
}) => (
  <div
    className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg p-3 pointer-events-none"
    style={{ left: position.x + 15, top: position.y + 15, maxWidth: 280 }}
  >
    <div className="flex items-center gap-2 mb-2">
      <Avatar className="h-8 w-8">
        <AvatarImage src={user.avatar_url || undefined} />
        <AvatarFallback>
          <User className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div>
        <p className="font-semibold text-foreground">{user.username || "User"}</p>
        <p className="text-xs text-muted-foreground">{user.total_sources_analyzed} sources</p>
      </div>
    </div>
    {cluster && (
      <div
        className="flex items-center gap-2 mb-2 px-2 py-1 rounded-full text-xs"
        style={{ backgroundColor: `${cluster.color}20` }}
      >
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cluster.color }} />
        <span style={{ color: cluster.color }}>{cluster.label}</span>
      </div>
    )}
    <div className="grid grid-cols-2 gap-1 text-xs">
      {CATEGORY_AXES.map((cat) => (
        <div key={cat.key} className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
          <span className="text-muted-foreground">{cat.name}:</span>
          <span className="font-medium">
            {Number(user[cat.key as keyof UserFingerprint]).toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  </div>
);

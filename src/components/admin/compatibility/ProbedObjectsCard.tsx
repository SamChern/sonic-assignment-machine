import { Card } from "@/components/ui/card";
import { type SampledObject } from "@/lib/compatibilityReport";

interface ProbedObjectsCardProps {
  objects: SampledObject[];
}

export const ProbedObjectsCard = ({ objects }: ProbedObjectsCardProps) => (
  <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
    <h2 className="mb-3 text-sm font-semibold">Probed deliveries</h2>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border/60">
            <th className="py-2 pr-3 font-medium">Object</th>
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 font-medium">Rows</th>
            <th className="py-2 pr-3 font-medium">With id</th>
            <th className="py-2 pr-3 font-medium">Summary</th>
            <th className="py-2 pr-3 font-medium">Roster</th>
            <th className="py-2 pr-3 font-medium">Tagged</th>
            <th className="py-2 font-medium">Columns</th>
          </tr>
        </thead>
        <tbody>
          {objects.map((o) => (
            <tr key={o.key} className="border-b border-border/40 last:border-0">
              <td className="max-w-[220px] truncate py-2 pr-3 font-mono" title={o.key}>
                {o.key.split("/").pop()}
              </td>
              <td className="py-2 pr-3">{o.report_type}</td>
              <td className="py-2 pr-3">{o.rows_read}</td>
              <td className="py-2 pr-3">{o.rows_with_identifier}</td>
              <td className="py-2 pr-3">{o.summary_rows}</td>
              <td className="py-2 pr-3">{o.roster_rows}</td>
              <td className="py-2 pr-3">{o.normalized_rows}</td>
              <td className="max-w-[260px] truncate py-2" title={o.columns.join(", ")}>
                {o.columns.length}: {o.columns.slice(0, 4).join(", ")}
                {o.columns.length > 4 ? "…" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Card>
);

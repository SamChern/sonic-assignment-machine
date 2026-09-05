import { type Report, type Scope } from "@/lib/compatibilityReport";

export interface ParallelResult {
  scope: Exclude<Scope, "all">;
  label: string;
  ok: boolean;
  ms: number;
  counts?: Report["summary"];
  error?: string;
}

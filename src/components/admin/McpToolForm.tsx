// Schema-driven form for MCP tool arguments.
// Reads a tool's JSON Schema `inputSchema` and renders native inputs so admins
// never have to hand-write JSON. Complex members (arrays/objects) fall back to a
// small JSON box for that single field only.
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  description?: string;
  title?: string;
  default?: unknown;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

const asSchema = (s: unknown): JsonSchema | null =>
  s && typeof s === "object" ? (s as JsonSchema) : null;

/** Collapse anyOf/oneOf (used for nullable/optional fields) to the first concrete branch. */
function resolve(schema: JsonSchema): JsonSchema {
  const branches = schema.anyOf ?? schema.oneOf;
  if (!branches?.length) return schema;
  const concrete = branches.find((b) => b?.type && b.type !== "null") ?? branches[0];
  return { ...concrete, description: schema.description ?? concrete.description, default: schema.default ?? concrete.default };
}

function baseType(schema: JsonSchema): string {
  const t = schema.type;
  if (Array.isArray(t)) return (t.find((x) => x !== "null") ?? "string") as string;
  return (t as string) ?? (schema.enum ? "string" : "string");
}

function initialText(schema: JsonSchema): string {
  const d = schema.default;
  if (d === undefined || d === null) return "";
  if (typeof d === "object") return JSON.stringify(d, null, 2);
  return String(d);
}

export function hasSchemaFields(schema: unknown): boolean {
  const s = asSchema(schema);
  return !!s?.properties && Object.keys(s.properties).length > 0;
}

export function McpToolForm({
  schema,
  onChange,
  resetKey,
}: {
  schema: unknown;
  /** Emits the typed argument object on every edit. */
  onChange: (args: Record<string, unknown>) => void;
  /** Change this (e.g. the tool name) to reset all fields. */
  resetKey?: string;
}) {
  const root = asSchema(schema);
  const fields = useMemo(() => {
    const props = root?.properties ?? {};
    return Object.entries(props).map(([name, raw]) => {
      const s = resolve(raw ?? {});
      return {
        name,
        schema: s,
        type: baseType(s),
        required: (root?.required ?? []).includes(name),
      };
    });
  }, [root]);

  const [text, setText] = useState<Record<string, string>>({});
  const [bools, setBools] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Seed defaults whenever the selected tool changes.
  useEffect(() => {
    const t: Record<string, string> = {};
    const b: Record<string, boolean> = {};
    for (const f of fields) {
      if (f.type === "boolean") b[f.name] = f.schema.default === true;
      else t[f.name] = initialText(f.schema);
    }
    setText(t);
    setBools(b);
    setErrors({});
  }, [resetKey, fields]);

  // Recompute args whenever any input changes.
  useEffect(() => {
    const args: Record<string, unknown> = {};
    const errs: Record<string, string> = {};
    for (const f of fields) {
      if (f.type === "boolean") {
        if (bools[f.name] || f.required) args[f.name] = !!bools[f.name];
        continue;
      }
      const raw = (text[f.name] ?? "").trim();
      if (!raw) continue;
      if (f.type === "number" || f.type === "integer") {
        const n = Number(raw);
        if (Number.isNaN(n)) errs[f.name] = "must be a number";
        else args[f.name] = f.type === "integer" ? Math.trunc(n) : n;
      } else if (f.type === "array" || f.type === "object") {
        const itemType = f.type === "array" ? baseType(resolve(f.schema.items ?? {})) : null;
        if (itemType && itemType !== "object" && itemType !== "array" && !raw.startsWith("[")) {
          // Comma-separated shorthand for scalar lists.
          args[f.name] = raw
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
            .map((v) => (itemType === "number" || itemType === "integer" ? Number(v) : v));
        } else {
          try {
            args[f.name] = JSON.parse(raw);
          } catch {
            errs[f.name] = "must be valid JSON";
          }
        }
      } else {
        args[f.name] = raw;
      }
    }
    setErrors(errs);
    onChange(args);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, bools, fields]);

  if (!fields.length) {
    return (
      <p className="text-xs text-muted-foreground">
        This tool takes no arguments — just run it.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const label = f.schema.title ?? f.name;
        const desc = f.schema.description;
        const enumVals = f.schema.enum?.map((v) => String(v)) ?? [];
        const wide = f.type === "object" || f.type === "array";
        return (
          <div key={f.name} className={`space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
            <Label className="text-xs">
              {label}
              {f.required && <span className="ml-1 text-destructive">*</span>}
              <span className="ml-1 font-normal text-muted-foreground">({f.type})</span>
            </Label>

            {f.type === "boolean" ? (
              <div className="flex h-9 items-center gap-2">
                <Switch
                  checked={!!bools[f.name]}
                  onCheckedChange={(v) => setBools((p) => ({ ...p, [f.name]: v }))}
                />
                <span className="text-xs text-muted-foreground">
                  {bools[f.name] ? "true" : "false"}
                </span>
              </div>
            ) : enumVals.length ? (
              <Select
                value={text[f.name] ?? ""}
                onValueChange={(v) => setText((p) => ({ ...p, [f.name]: v }))}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {enumVals.map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : wide ? (
              <Textarea
                rows={3}
                spellCheck={false}
                value={text[f.name] ?? ""}
                placeholder={
                  f.type === "array"
                    ? "comma-separated values, or a JSON array"
                    : "JSON object"
                }
                onChange={(e) => setText((p) => ({ ...p, [f.name]: e.target.value }))}
                className="font-mono text-[11px]"
              />
            ) : (
              <Input
                className="h-9 text-xs"
                type={f.type === "number" || f.type === "integer" ? "number" : "text"}
                value={text[f.name] ?? ""}
                placeholder={f.required ? "required" : "optional"}
                onChange={(e) => setText((p) => ({ ...p, [f.name]: e.target.value }))}
              />
            )}

            {errors[f.name] ? (
              <p className="text-[11px] text-destructive">{errors[f.name]}</p>
            ) : desc ? (
              <p className="line-clamp-2 text-[11px] text-muted-foreground">{desc}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default McpToolForm;

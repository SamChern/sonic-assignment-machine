import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";

export interface PaletteDestination {
  to: string;
  label: string;
}

interface Hit {
  label: string;
  hint: string;
  to: string;
}

/**
 * Step 16c — ⌘K over the whole admin surface: pages, cohorts, ingest files and
 * users in one input, so fourteen routes stop being a navigation problem.
 */
export const AdminCommandPalette = ({
  destinations,
  extra = [],
}: {
  destinations: PaletteDestination[];
  extra?: PaletteDestination[];
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const results: Hit[] = [];
      const safe = async (fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (err) {
          console.error("palette search failed", err);
        }
      };

      await Promise.all([
        safe(async () => {
          const { data } = await supabase
            .from("sonic_cohorts")
            .select("id,name,slug")
            .ilike("name", `%${q}%`)
            .limit(5);
          (data ?? []).forEach((c) =>
            results.push({ label: c.name ?? c.slug, hint: "Cohort", to: "/admin/workbench" }),
          );
        }),
        safe(async () => {
          const { data } = await supabase
            .from("intuizi_ingest_files")
            .select("id,object_key,status")
            .ilike("object_key", `%${q}%`)
            .limit(5);
          (data ?? []).forEach((f) =>
            results.push({
              label: f.object_key,
              hint: `File · ${f.status}`,
              to: "/admin/pipeline",
            }),
          );
        }),
        safe(async () => {
          const { data } = await supabase
            .from("profiles")
            .select("id,display_name,user_id")
            .ilike("display_name", `%${q}%`)
            .limit(5);
          (data ?? []).forEach((p) =>
            results.push({
              label: p.display_name ?? p.user_id,
              hint: "User",
              to: "/admin/workbench",
            }),
          );
        }),
      ]);

      if (!cancelled) setHits(results);
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const go = (to: string) => {
    setOpen(false);
    setQuery("");
    navigate(to);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Jump to a page, cohort, file or user…"
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Pages">
          {[...destinations, ...extra].map((d) => (
            <CommandItem key={d.to} value={d.label} onSelect={() => go(d.to)}>
              {d.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {hits.length > 0 && (
          <CommandGroup heading="Records">
            {hits.map((h, i) => (
              <CommandItem
                key={`${h.to}-${h.label}-${i}`}
                value={`${h.label} ${h.hint}`}
                onSelect={() => go(h.to)}
              >
                <span className="truncate">{h.label}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{h.hint}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
};

export default AdminCommandPalette;

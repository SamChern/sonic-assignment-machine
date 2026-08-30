import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ComplianceAlert } from "@/components/admin/ComplianceAlert";
import { AdminDigestCard } from "@/components/admin/AdminDigestCard";
import { AdminCommandPalette } from "@/components/admin/AdminCommandPalette";

import {
  Activity,
  ArrowLeft,
  BookOpen,
  Command,
  Eye,
  Fingerprint,
  Layers,
  Library,
  Plug,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useUiPreferenceValue } from "@/hooks/useUiPreference";
import { supabase } from "@/integrations/supabase/client";

/**
 * /admin is a status overview, not a workbench. Every heavy surface it used to
 * host inline now lives on its own route, so this page loads fast, says what the
 * system is doing, and points at the one place to go next.
 *
 * Step 16c layers three depths over the same surface — Glance, Operate,
 * Diagnose — plus a ⌘K palette, a daily digest and preview-as-role.
 */

type Depth = "glance" | "operate" | "diagnose";

const DEPTHS: { value: Depth; label: string; blurb: string }[] = [
  { value: "glance", label: "Glance", blurb: "Is the system healthy right now?" },
  { value: "operate", label: "Operate", blurb: "Knobs, approvals, access." },
  { value: "diagnose", label: "Diagnose", blurb: "Ledgers, failures, drift." },
];

const PREVIEW_ROLES: { label: string; to: string }[] = [
  { label: "Consumer", to: "/?preview_role=curious" },
  { label: "Enterprise viewer", to: "/workspace?preview_role=marketing" },
  { label: "Creator", to: "/creator?preview_role=creator" },
];

const DESTINATIONS: {
  to: string;
  label: string;
  description: string;
  icon: typeof Users;
  depths: Depth[];
}[] = [
  {
    to: "/admin/workbench",
    label: "Users, cohorts & fingerprints",
    description: "Cross-user analysis, aggregate networks, scope & compare.",
    icon: Users,
    depths: ["glance", "operate", "diagnose"],
  },
  {
    to: "/admin/semantic",
    label: "SonicSIM analysis results",
    description: "Post-ingestion semantic processing and confidence breakdown.",
    icon: Radio,
    depths: ["glance", "diagnose"],
  },
  {
    to: "/admin/pipeline",
    label: "Intuizi Console",
    description: "Audiences, activations and taxonomy mapping.",
    icon: Layers,
    depths: ["operate", "diagnose"],
  },
  {
    to: "/admin/compatibility",
    label: "Ingestion compatibility",
    description: "Per-source test runs and debug reruns.",
    icon: ShieldCheck,
    depths: ["diagnose"],
  },
  {
    to: "/admin/activations",
    label: "Activation access",
    description: "Grant Intuizi activations to organizations.",
    icon: ShieldCheck,
    depths: ["operate"],
  },
  {
    to: "/admin/integrations",
    label: "APIs & MCPs",
    description: "Connected providers and setup that still needs input.",
    icon: Plug,
    depths: ["operate"],
  },
  {
    to: "/admin/sound-library",
    label: "Sound Library",
    description: "Grounding coverage, gap curation and versioned grounding packs.",
    icon: Library,
    depths: ["operate", "diagnose"],
  },
  {
    to: "/admin/control-room",
    label: "Control Room",
    description: "Pipeline knobs, thresholds and calibration priors.",
    icon: SlidersHorizontal,
    depths: ["operate"],
  },
  {
    to: "/admin/guide",
    label: "Guide & Glossary",
    description: "What every term means, how each subsystem is set up, and what is live.",
    icon: BookOpen,
    depths: ["glance", "operate", "diagnose"],
  },
  {
    to: "/admin/ec2",
    label: "EC2 & inference status",
    description: "Worker health, retention compliance, librosa service.",
    icon: Activity,
    depths: ["glance", "diagnose"],
  },
];

const METRICS = [
  { key: "profiles", label: "Users", gradient: "var(--gradient-cognitive)" },
  { key: "audio_sources", label: "Audio sources", gradient: "var(--gradient-contextual)" },
  { key: "source_analyses", label: "Analyses", gradient: "var(--gradient-social)" },
  { key: "user_fingerprints", label: "Fingerprints", gradient: "var(--gradient-artistic)" },
] as const;


const AdminDashboard = () => {
  const navigate = useNavigate();
  const { isAdmin, loading } = useAuth();
  const [counts, setCounts] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      // Per-metric isolation: one unreadable table must not blank every count.
      const entries = await Promise.all(
        METRICS.map(async (m) => {
          try {
            const { count, error } = await supabase
              .from(m.key as never)
              .select("*", { count: "exact", head: true });
            if (error) throw error;
            return [m.key, count ?? null] as const;
          } catch (err) {
            console.error(`admin metric ${m.key} failed`, err);
            return [m.key, null] as const;
          }
        }),
      );
      if (!cancelled) setCounts(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!loading && !isAdmin) navigate("/", { replace: true });
  }, [loading, isAdmin, navigate]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60 bg-card/50 px-4 py-4 backdrop-blur-sm sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">Admin overview</h1>
            <p className="text-sm text-muted-foreground">System status and where to go next.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Home
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 pb-mobile-nav sm:px-6">
        <div className="mb-4">
          <ComplianceAlert to="/admin/ec2" />
        </div>
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">

          {METRICS.map((m) => (
            <Card
              key={m.key}
              className="relative overflow-hidden border-border/60 bg-card/70 p-4 backdrop-blur-sm"
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-1"
                style={{ background: m.gradient }}
              />
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p
                className="truncate bg-clip-text text-2xl font-semibold text-transparent sm:text-3xl"
                style={{ backgroundImage: m.gradient }}
              >
                {counts[m.key] === undefined ? "—" : (counts[m.key] ?? 0).toLocaleString()}
              </p>
            </Card>
          ))}
        </div>

        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Fingerprint className="h-4 w-4" />
          Admin surfaces
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DESTINATIONS.map(({ to, label, description, icon: Icon }) => (
            <Link key={to} to={to} className="group">
              <Card className="h-full border-border/60 bg-card/70 p-4 backdrop-blur-sm transition-smooth group-hover:shadow-elegant">
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-primary/10 p-2 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;

// Serves the EC2 ingest worker program and its systemd unit (Step 2.5-alt), so
// setting up the box is a short download instead of pasting a long heredoc.
//
//   curl -sS -H "x-worker-secret: $WORKER_SECRET" \
//     "<functions-url>/ingest-worker-bootstrap?file=worker.py" -o worker.py
//
// Auth: the shared INGEST_WORKER_SECRET (or the service-role token). Nothing
// here is secret by itself, but gating it keeps the surface closed.

import { SYSTEMD_UNIT, WORKER_PY } from "./workerSource.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret",
};

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function secretMatches(provided: string | null): boolean {
  const expected = Deno.env.get("INGEST_WORKER_SECRET");
  if (!expected || !provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? null;
  const url = new URL(req.url);
  const provided = req.headers.get("x-worker-secret") ?? url.searchParams.get("secret");
  const ok = (bearer && SERVICE_KEY && bearer === SERVICE_KEY) || secretMatches(provided);
  if (!ok) {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const which = (url.searchParams.get("file") ?? "worker.py").toLowerCase();
  const body = which.includes("service") || which.includes("systemd") ? SYSTEMD_UNIT : WORKER_PY;

  return new Response(body, {
    headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
});

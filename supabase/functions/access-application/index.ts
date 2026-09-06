// Records a Creator application or an Enterprise demo inquiry sent from the
// open website and notifies the SonicSIM inbox. Runs without a JWT because
// visitors are not signed in when they apply.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NOTIFY_TO = "hello@sonicsimai.com";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const text = (value: unknown, max: number) => {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, max) : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind ?? "").trim();
    if (kind !== "creator" && kind !== "enterprise") {
      return json({ error: "Unknown application type." }, 400);
    }

    const email = String(body?.contact_email ?? "").trim().toLowerCase();
    const contactName = text(body?.contact_name, 120);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 255) {
      return json({ error: "A valid email address is required." }, 400);
    }
    if (!contactName) return json({ error: "A name is required." }, 400);
    if (body?.terms_accepted !== true) {
      return json({ error: "The terms must be accepted." }, 400);
    }

    const row = {
      kind,
      contact_name: contactName,
      contact_email: email,
      org_name: text(body?.org_name, 160),
      website: text(body?.website, 400),
      catalogue_size: text(body?.catalogue_size, 60),
      team_size: text(body?.team_size, 60),
      use_case: text(body?.use_case, 2000),
      message: text(body?.message, 2000),
      preferred_timing: text(body?.preferred_timing, 200),
      terms_accepted: true,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500),
    };

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: saved, error } = await supabase
      .from("access_applications")
      .insert(row)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("access_applications insert failed", error.message);
      return json({ error: "We couldn't record that just now." }, 500);
    }

    let notified = false;
    try {
      const subject =
        kind === "creator"
          ? `Creator application: ${row.org_name ?? contactName}`
          : `Enterprise demo inquiry: ${row.org_name ?? contactName}`;
      const html =
        `<p>New ${kind} submission on SonicSIM.</p><ul>` +
        `<li>Name: ${contactName}</li>` +
        `<li>Email: ${email}</li>` +
        (row.org_name ? `<li>Organisation / artist: ${row.org_name}</li>` : "") +
        (row.website ? `<li>Links: ${row.website}</li>` : "") +
        (row.catalogue_size ? `<li>Catalogue size: ${row.catalogue_size}</li>` : "") +
        (row.team_size ? `<li>Team size: ${row.team_size}</li>` : "") +
        (row.use_case ? `<li>Use: ${row.use_case}</li>` : "") +
        (row.preferred_timing ? `<li>Preferred timing: ${row.preferred_timing}</li>` : "") +
        (row.message ? `<li>Message: ${row.message}</li>` : "") +
        `<li>Recorded: ${new Date().toISOString()}</li></ul>`;
      const { error: mailError } = await supabase.rpc("enqueue_email", {
        queue_name: "transactional_emails",
        payload: {
          to: NOTIFY_TO,
          subject,
          html,
          purpose: "transactional",
          idempotency_key: `access-application-${saved?.id ?? email}`,
        },
      });
      if (mailError) throw mailError;
      notified = true;
    } catch (err) {
      console.warn("Application notification not sent yet:", String(err));
    }

    if (notified && saved?.id) {
      await supabase
        .from("access_applications")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", saved.id);
    }

    return json({ ok: true, id: saved?.id ?? null, notified });
  } catch (err) {
    console.error("access-application failed", err);
    return json({ error: "Unexpected error." }, 500);
  }
});

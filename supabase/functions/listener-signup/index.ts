// Records a Listener sign-up: the email address, the terms acceptance, and a
// notification to the SonicSIM inbox. Runs without a JWT because it is called
// right after sign-up, before the address is confirmed.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    const termsAccepted = body?.terms_accepted === true;
    const dataSharing = body?.data_sharing_accepted === true;
    const plan = String(body?.plan ?? "listener").slice(0, 32);

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 255) {
      return json({ error: "A valid email address is required." }, 400);
    }
    if (!termsAccepted) {
      return json({ error: "The terms must be accepted." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: row, error } = await supabase
      .from("listener_signups")
      .insert({
        email,
        plan,
        terms_accepted: termsAccepted,
        data_sharing_accepted: dataSharing,
        user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500),
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("listener_signups insert failed", error.message);
      return json({ error: "We couldn't record that sign-up." }, 500);
    }

    // Notify the SonicSIM inbox. Queued through the project's email
    // infrastructure when it is configured; otherwise the record stays pending
    // so nothing is lost.
    let notified = false;
    try {
      const subject = `New ${plan} sign-up: ${email}`;
      const html =
        `<p>A new ${plan} account was created on SonicSIM.</p>` +
        `<ul><li>Email: ${email}</li>` +
        `<li>Terms accepted: yes</li>` +
        `<li>Data sharing accepted: ${dataSharing ? "yes" : "no"}</li>` +
        `<li>Recorded: ${new Date().toISOString()}</li></ul>`;
      const { error: mailError } = await supabase.rpc("enqueue_email", {
        queue_name: "transactional_emails",
        payload: {
          to: NOTIFY_TO,
          subject,
          html,
          purpose: "transactional",
          idempotency_key: `listener-signup-${row?.id ?? email}`,
        },
      });
      if (mailError) throw mailError;
      notified = true;
    } catch (err) {
      console.warn("Sign-up notification not sent yet:", String(err));
    }

    if (notified && row?.id) {
      await supabase
        .from("listener_signups")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", row.id);
    }

    return json({ ok: true, id: row?.id ?? null, notified });
  } catch (err) {
    console.error("listener-signup failed", err);
    return json({ error: "Unexpected error." }, 500);
  }
});

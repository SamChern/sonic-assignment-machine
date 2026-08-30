import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import sonicSimLogo from "@/assets/SonicSIM_transp.png";

/**
 * OAuth 2.1 consent screen, mounted at /.lovable/oauth/consent.
 *
 * An external MCP client (ChatGPT, Claude, Lovable) sends the user here with an
 * `authorization_id`; approving mints a user-scoped token so the app's MCP tools
 * act as this account under the existing row-level security.
 */

interface AuthorizationClient {
  name?: string | null;
  client_name?: string | null;
  redirect_uri?: string | null;
}

interface AuthorizationDetails {
  client?: AuthorizationClient | null;
  scope?: string | null;
  scopes?: string[] | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
}

interface OAuthResult {
  data: AuthorizationDetails | null;
  error: { message: string } | null;
}

/** Thin typed view of the beta `supabase.auth.oauth` namespace. */
const oauth = () =>
  (supabase.auth as unknown as {
    oauth: {
      getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
      approveAuthorization: (id: string) => Promise<OAuthResult>;
      denyAuthorization: (id: string) => Promise<OAuthResult>;
    };
  }).oauth;

const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirm who you are",
  email: "Share your email address",
  profile: "Share your basic profile",
};

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";

  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("This link is missing its authorization request id.");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // Preserve the FULL consent URL so sign-in returns the user here.
        const next = window.location.pathname + window.location.search;
        window.location.href = `/auth?next=${encodeURIComponent(next)}`;
        return;
      }
      if (!active) return;
      setEmail(sess.session.user.email ?? null);

      const { data, error: detErr } = await oauth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (detErr) {
        setError(detErr.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    const api = oauth();
    const { data, error: decErr } = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (decErr) {
      setBusy(false);
      setError(decErr.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("The authorization server did not return a redirect target.");
      return;
    }
    window.location.href = target;
  };

  const clientName =
    details?.client?.name ?? details?.client?.client_name ?? "this application";
  const scopes = details?.scopes ?? (details?.scope ? details.scope.split(/\s+/) : []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md border-primary/20">
        <CardHeader className="space-y-3">
          <img src={sonicSimLogo} alt="SonicSIM" className="h-8 w-auto self-start" />
          {error ? (
            <>
              <CardTitle className="text-xl">Could not load this request</CardTitle>
              <CardDescription>{error}</CardDescription>
            </>
          ) : !details ? (
            <>
              <CardTitle className="text-xl">Checking this request…</CardTitle>
              <CardDescription>One moment.</CardDescription>
            </>
          ) : (
            <>
              <CardTitle className="text-xl">Connect {clientName} to SonicSIM</CardTitle>
              <CardDescription>
                {clientName} will be able to call SonicSIM's enabled tools as you.
              </CardDescription>
            </>
          )}
        </CardHeader>

        {details && !error && (
          <CardContent className="space-y-5">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
              <p className="text-muted-foreground">Signed in as</p>
              <p className="font-medium">{email ?? "your account"}</p>
              {details.client?.redirect_uri && (
                <p className="mt-2 break-all text-xs text-muted-foreground">
                  Returns to {details.client.redirect_uri}
                </p>
              )}
            </div>

            <ul className="space-y-1.5 text-sm">
              {scopes.length > 0 ? (
                scopes.map((s) => (
                  <li key={s} className="text-muted-foreground">
                    • {SCOPE_LABELS[s] ?? `Additional permission requested: ${s}`}
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground">• Confirm who you are</li>
              )}
              <li className="text-muted-foreground">
                • Read your analyses, sonic fingerprint and taxonomy searches
              </li>
            </ul>

            <p className="text-xs text-muted-foreground">
              This does not bypass SonicSIM's permissions or backend policies.
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
                Approve
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                disabled={busy}
                onClick={() => decide(false)}
              >
                Cancel connection
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </main>
  );
}

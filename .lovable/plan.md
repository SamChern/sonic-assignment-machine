# Plan: Admin-Only API Credentials Settings Page

A new admin-gated route that lets you manage credentials for any third-party API (Apple Music first, more later) with built-in connection testing. Designed so adding a future provider = adding one config object, no UI rewrites.

---

## Design Principles

- **Zero impact on existing UI** — new route at `/admin/integrations`, accessed via a small "API Integrations" link inside the existing Admin Dashboard header. Nothing else changes.
- **Admin-only** — gated by `useAuth().isAdmin`, same pattern as `/admin`. Non-admins get redirected.
- **Provider-registry driven** — one `INTEGRATIONS` array describes each provider's fields, instructions, and test endpoint. Adding YouTube Music or Last.fm later = appending one entry.
- **Secrets stay server-side** — credentials submitted from the UI are written to Supabase secrets via a privileged edge function, never stored in the database or exposed to the client after save.

---

## Architecture

### 1. Provider Registry (`src/config/integrations.ts`) — NEW

A single source of truth describing every third-party integration:

```ts
export interface IntegrationField {
  key: string;              // env var name, e.g. "APPLE_TEAM_ID"
  label: string;            // "Team ID"
  type: "text" | "password" | "textarea";
  placeholder: string;
  helpText: string;         // "10-char alphanumeric, top-right of dev console"
  required: boolean;
}

export interface Integration {
  id: string;               // "apple_music"
  name: string;             // "Apple Music"
  description: string;
  docsUrl: string;
  setupSteps: string[];     // bullet list shown in collapsible "Setup Guide"
  fields: IntegrationField[];
  testEndpoint: string;     // edge function name, e.g. "apple-music-test"
  status?: "configured" | "missing" | "unknown";  // computed at runtime
}
```

Apple Music entry includes the 5-step guide we discussed (enroll → Team ID → Media ID → Key → .p8) and three fields: `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (textarea).

### 2. New Page: `src/pages/AdminIntegrations.tsx` — NEW

- Admin-gated (redirects non-admins, mirrors `AdminDashboard.tsx` auth pattern)
- Lists all integrations from the registry as cards with:
  - Status badge: ✅ Configured / ⚠️ Missing / ❌ Test failed
  - "Setup Guide" collapsible (renders `setupSteps`)
  - Form with one input per field
  - **Save Credentials** button (writes to secrets via edge function)
  - **Test Connection** button (calls the integration's test endpoint, shows latency + result)
  - Last-tested timestamp + last-test outcome

### 3. Two New Edge Functions

**`supabase/functions/admin-set-secret/index.ts`** (generic, reusable)
- Validates caller is admin via JWT + `has_role()` check
- Accepts `{ secrets: Record<string, string> }`
- Writes to Supabase secrets via the Management API using `SUPABASE_SERVICE_ROLE_KEY`
- Allow-lists which secret names can be written (drawn from the registry — prevents arbitrary secret writes)
- Returns success/failure per key

**`supabase/functions/apple-music-test/index.ts`** (per-provider)
- Mints an Apple Music JWT from `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY` using `djwt` (ES256)
- Calls `https://api.music.apple.com/v1/test` (or a cheap catalog search) with `Authorization: Bearer <jwt>`
- Returns `{ success: boolean, latency_ms, error?, sample?: {...} }`
- Future providers each get their own `*-test` function — the registry tells the page which to invoke

### 4. New DB Table: `integration_test_history` (optional but useful)

```sql
CREATE TABLE public.integration_test_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id text NOT NULL,
  tested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  success boolean NOT NULL,
  latency_ms integer,
  error_message text,
  tested_at timestamptz DEFAULT now()
);
ALTER TABLE public.integration_test_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read test history" ON public.integration_test_history
  FOR SELECT USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert test history" ON public.integration_test_history
  FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'));
```

Lets you see "last 5 test results" per integration on the page.

### 5. Routing

`src/App.tsx` — add one route:
```tsx
<Route path="/admin/integrations" element={<AdminIntegrations />} />
```

`src/pages/AdminDashboard.tsx` — add a small button in the header (next to "Back" and existing controls): **"⚙️ API Integrations"** linking to `/admin/integrations`. No layout change beyond one button.

---

## Security

- **Admin gate, twice**: client redirects non-admins; edge function rejects non-admin JWTs server-side via `has_role(auth.uid(), 'admin')` SECURITY DEFINER call.
- **Allow-list of writable secret names** in `admin-set-secret` — only keys declared in the registry can be written. Prevents an admin (or compromised admin token) from overwriting `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, etc.
- **Never read secrets back to the client** — UI shows masked placeholders ("•••• configured") if the secret is set; actual values stay server-side. A "Status" check endpoint returns only booleans.
- **Audit trail** via `integration_test_history`.
- **Input validation** with Zod on both edge functions.

---

## Adding a Future Provider (Example: YouTube Music)

1. Append one entry to `INTEGRATIONS` in `src/config/integrations.ts` (fields, setup steps, test endpoint name)
2. Add the secret names to the allow-list (auto-derived from the registry — no extra step)
3. Create one new edge function `youtube-music-test/index.ts`
4. Done. UI renders the new card automatically. **No changes to `AdminIntegrations.tsx` itself.**

---

## Files

| File | Action |
|---|---|
| `src/config/integrations.ts` | CREATE — provider registry |
| `src/pages/AdminIntegrations.tsx` | CREATE — settings page |
| `src/App.tsx` | EDIT — add route |
| `src/pages/AdminDashboard.tsx` | EDIT — add header link button only |
| `supabase/functions/admin-set-secret/index.ts` | CREATE — generic secret writer |
| `supabase/functions/apple-music-test/index.ts` | CREATE — Apple Music JWT + test call |
| `supabase/migrations/<new>.sql` | CREATE — `integration_test_history` table |

---

## Open Question Before Build

**Secret writing approach** — the cleanest path uses Supabase's Management API to write project secrets, which requires a `SUPABASE_ACCESS_TOKEN` (personal access token, separate from `SERVICE_ROLE_KEY`). Alternatives:

- **(A) Management API** — true secret writes, persists across deploys, requires you to add one `SUPABASE_ACCESS_TOKEN` secret manually once. **Recommended.**
- **(B) DB-backed credentials table** — encrypted credentials in a Postgres table read by edge functions at runtime. No external token needed, but encryption key still has to live somewhere.
- **(C) Manual paste** — UI just generates a copy-paste block; you add secrets yourself via the Lovable Cloud secret tool. Simplest, least convenient.

I'll ask you to pick (A/B/C) right after you approve the overall plan, before building.

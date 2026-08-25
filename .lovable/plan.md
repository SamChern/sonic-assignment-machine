# Why you aren't seeing the enterprise workspace (and how to fix it)

The enterprise build is actually in the app — it just has no way in, and refreshing throws you out of it.

What already exists and is verified:
- An enterprise workspace page at `/workspace` with 7 tabs: Analyses, My data, Discovery, Categories, Predict users, Predict outcomes, Tracking tags.
- Backend: your `SAM-Master` organization exists on the `enterprise` plan with 1 member (your account), plus dataset ingest, dataset scoring, prediction, and pixel-collection functions and a first-party tag script.

Three real gaps explain what you're seeing:

1. **No login/nav entry point.** The only link to `/workspace` is buried inside the "Get started" onboarding dialog on the homepage. It is not on the header, not on the mobile bottom nav, and not offered after sign-in.
2. **Refresh kicks you back to the homepage.** The fresh-session guard only treats `/`, `/admin`, `/auth`, `/reset-password` as safe. Any reload or new tab on `/workspace` silently redirects to `/`, so the page looks like it doesn't exist.
3. **Pixel is first-party only.** The Tracking tags tab issues a SonicSIM tag and collects KPI events, but there is no Google Ads / GTM, Meta, or TikTok setup guidance or ID capture like your reference steps describe.

## What I'll implement

### 1. Enterprise access UI
- Header entry on the homepage: an "Enterprise workspace" button shown when the signed-in user belongs to an organization (hidden otherwise, so nothing changes for normal users).
- Post-sign-in routing: enterprise members land on, or are prompted toward, `/workspace`.
- "Enterprise" item added to the mobile bottom nav for org members.
- Signed-out visit to `/workspace` sends you to sign-in and returns you to `/workspace` afterward.
- Non-member signed-in visit shows a clear "no enterprise license on this account" state with the Learn More contact link instead of a blank page.

### 2. Make the workspace refresh-safe
- Add `/workspace` (and its `?tab=` deep links) to the stable-path set so reloads and new tabs stay put.
- Remember the last tab per user so the workspace reopens where you left it.

### 3. Homepage enterprise section
- Promote the enterprise block out of the onboarding dialog into a visible homepage section describing the four dashboard capabilities (recent analyses, upload my own data, dataset discovery, predict users/outcomes) with the workspace call-to-action and the placeholder Learn More mailto.

### 4. Ad-platform pixel integration
- Extend the Tracking tags tab into "Tracking & pixels" with per-organization fields for Google tag ID (`GT-`/`AW-`), Google Ads conversion ID + label, Meta pixel ID, and TikTok pixel ID.
- Generate copy-paste snippets for each: base Google tag, Google Ads conversion event, Meta `fbq`, TikTok `ttq` — plus GTM instructions matching your Step 1-4 flow.
- Optional: inject the Google tag into the published SonicSIM site itself when you supply an ID, so conversions on this domain are tracked.
- Map incoming pixel/KPI events to the six-category scoring so Predict SonicSIM-Outcomes can train on them (site traffic, CPC, CTR, page views, VCR, time on site).

### 5. Verification before I report done
- Sign in as your account in the preview, open `/workspace`, reload it, click through all tabs, and confirm each panel loads org-scoped data with no console errors.

## Technical notes

- `src/App.tsx`: add `/workspace` to `stableRefreshPaths`; keep the guard for deep admin tool pages.
- `src/pages/Index.tsx`: move the enterprise block into the page body; add an org-aware workspace button using `useOrganization`.
- `src/components/MobileBottomNav.tsx`: conditional enterprise item.
- `src/pages/Workspace.tsx`: auth redirect preserving return path, non-member empty state, remembered tab.
- New table `org_tracking_settings` (organization-scoped, RLS + grants) for the ad-platform IDs; snippet generation stays client-side, and no ad-platform secrets are stored.
- `supabase/functions/pixel-collect` and `predict-outcomes` extended to accept and use the KPI metrics above.

Nothing here changes your admin dashboard or the existing analysis pipeline.

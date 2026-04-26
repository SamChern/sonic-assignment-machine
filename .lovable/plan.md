# Fix GitHub Actions for the Lovable web app

## Problem
The two default GitHub Actions workflows (`node.js.yml`, `npm-publish-github-packages.yml`) are auto-generated Node *library* templates and don't fit this Vite/React web app. They fail on every push because:

1. `npm test` is invoked but no `test` script exists in `package.json`.
2. The Node 18.x matrix leg can't build (Vite 5, `@types/node@22`, modern deps require Node ≥ 20).
3. `npm publish` is attempted on a `private: true`, unscoped package on every release — guaranteed to fail.
4. No lint step, so real issues wouldn't be caught here anyway.

The `handleSave` placeholder-validation code in `src/pages/AdminIntegrations.tsx` (lines 218–255) is **valid and not the cause** of the CI failures — it's pure frontend code that the workflows never even reach because `npm ci` / `npm test` blow up first.

## Plan

### 1. Replace `.github/workflows/node.js.yml` with a CI that matches this project
- Single Node version: **20.x** (drop 18.x and 22.x — 18 is EOL for the toolchain, 22 is unnecessary noise).
- Steps: `checkout` → `setup-node` (with npm cache) → `npm ci` → `npm run lint` → `npm run build`.
- Drop the bare `npm test` step (no tests configured). Use `npm test --if-present` if we want a placeholder.
- Trigger on `push`/`pull_request` to `main` (unchanged).

### 2. Delete `.github/workflows/npm-publish-github-packages.yml`
- This is a private app, not a library. There's nothing to publish to GitHub Packages.
- Removing it stops the failing release-triggered run entirely.

### 3. Verify lockfile consistency
- `npm ci` requires `package-lock.json` to match `package.json`. If you've been editing primarily through Lovable (which uses `bun`), the lockfile may drift. If CI still fails on `npm ci` after the workflow rewrite, the follow-up is to regenerate `package-lock.json` locally with `npm install` and commit it — or switch the workflow to `bun` (`oven-sh/setup-bun@v2` + `bun install --frozen-lockfile` + `bun run build`).

### 4. No changes needed to `AdminIntegrations.tsx`
- The placeholder-pattern code you pasted compiles and runs correctly today.

## Files changed
- **Edit**: `.github/workflows/node.js.yml` — rewrite for a Vite app: Node 20, install + lint + build, no publish, no test.
- **Delete**: `.github/workflows/npm-publish-github-packages.yml`.

## Open question
Do you want CI to use **npm** (current setup, requires `package-lock.json` to stay in sync) or **bun** (matches what Lovable uses internally — more reliable, but means switching the workflow's setup action)? Default is npm unless you say otherwise.
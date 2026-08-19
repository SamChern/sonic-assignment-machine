# Move CI off deprecated Node 20

## What I could and couldn't check

I don't have access to your GitHub Actions run logs from here (no GitHub connection is linked to this project), so I can't quote specific failed runs. What I can confirm from the codebase:

- `.github/workflows/node.js.yml` pins `node-version: 20.x` and uses `actions/checkout@v4` / `actions/setup-node@v4`, both of which run on the deprecated `node20` action runtime.
- `package.json` has no `engines` field and there is no `.nvmrc`, so nothing else in the repo pins Node 20.

Per the GitHub changelog, `node20` is being phased out on runners and JavaScript actions must declare `using: node24` in their metadata; consuming repos fix this by upgrading to action major versions that ship a `node24` runtime and by building/testing on a supported Node.

## Changes

1. `.github/workflows/node.js.yml`
   - Bump the build matrix to Node 24 (`node-version: 24.x`), which matches the runtime the runners now provide.
   - Upgrade `actions/checkout@v4` to `@v5` and `actions/setup-node@v4` to `@v5` — these releases declare `using: node24`, which removes the deprecation warnings.
   - Keep the existing steps (`npm ci`, advisory lint, build, conditional test) unchanged.

2. `package.json`
   - Add an `engines` field (`"node": ">=20.19 <25"` style range) so local installs and CI agree on a supported Node, and Node 20-only assumptions can't creep back in.

3. `.nvmrc` (new)
   - Pin `24` for local development parity with CI.

## Notes

- No application code, Vite config, or dependency versions need to change: Node 24 is compatible with the Vite 5 / TypeScript 5 toolchain this project uses.
- Supabase edge functions run on Deno and are unaffected by the Actions Node runtime change.
- The EC2 librosa deployment is Python-based and unaffected.
- After merging, the first workflow run on `main` is the verification point — if any transitive dependency has a native build that fails on Node 24, the fix is to pin that dependency, not to revert the runner Node version.

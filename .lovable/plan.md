# Plan: Integrate `hugohow/mcp-music-analysis` (librosa MCP)

## 🔍 What I found in the repo

`hugohow/mcp-music-analysis` is a **Python FastMCP server using stdio transport** (launched via `uvx mcp-music-analysis`, designed for Claude Desktop). It is **not a remote HTTP/SSE server** out of the box — Claude Desktop spawns it as a local subprocess and pipes JSON-RPC over stdin/stdout.

### Tools actually exposed (from `server.py`)
| Tool | Purpose | Maps to your category |
|---|---|---|
| `load(file_path, offset, duration)` | Loads audio → CSV path of waveform | Utilities - array (loosely) |
| `get_duration(y_path)` | Audio duration in seconds | Utilities - misc |
| `tempo(y_path, ...)` | BPM estimation | Feature extraction |
| `beat_track(y_path, ...)` | Beat positions | Temporal segmentation |
| `chroma_cqt(y_path, ...)` | Chroma CQT → CSV | Feature extraction |
| `mfcc(y_path)` | MFCC → CSV | Feature extraction |
| `download_from_url(url)` | Fetch remote .mp3/.wav | Utility |
| `download_from_youtube(url)` | YouTube → audio file | Utility |

### ⚠️ Honest gaps vs. your request
You asked for these capability buckets — here's what's actually available:
- ✅ **Feature extraction** — `mfcc`, `chroma_cqt`, `tempo` are present
- ⚠️ **Temporal segmentation** — only `beat_track`; no `librosa.segment.agglomerative` or onset_detect wrapper
- ❌ **Sequential modeling** — not exposed by this server
- ❌ **Utilities (array / matching / misc)** — `librosa.util.*` is not wrapped as MCP tools
- ❌ **Laplacian segmentation** — `librosa.segment.recurrence_matrix` + Laplacian decomposition is not exposed

To get the missing capabilities you'd need to **fork the repo and add `@mcp.tool()` wrappers** around the corresponding `librosa` functions. I can do this as a follow-up if you want. For now the plan integrates what exists today.

---

## 🚧 The transport problem (and 3 ways to solve it)

Your current "Generic MCP Server" config in `src/config/integrations.ts` expects a `MCP_SERVER_URL` (Streamable HTTP / SSE). But this librosa server only speaks **stdio**. Three paths:

### Option A — Run it on your existing EC2 instance behind an HTTP bridge ⭐ recommended
You already have an EC2 deployment (per `mem://architecture/ec2-deployment-config`). Add a tiny FastAPI/Express wrapper there that:
1. Spawns `uvx mcp-music-analysis` as a child process
2. Exposes a `/mcp` HTTP endpoint that proxies JSON-RPC over the subprocess's stdin/stdout
3. Or, even simpler: re-publish the same tools as plain REST endpoints (`POST /tempo`, `POST /mfcc`, etc.) and skip MCP semantics entirely on the wire

The MCP spec has a community pattern called `mcp-proxy` (https://github.com/sparfenyuk/mcp-proxy) that does exactly the stdio→SSE bridge with one command. EC2 is the right home because it can persist temp files between `load` and downstream calls, which the server requires (see "state limitation" below).

### Option B — Use Smithery's hosted version
Smithery (https://smithery.ai/server/@hugohow/mcp-music-analysis) hosts this server. If they expose an HTTP endpoint with a Smithery API key, you can plug that URL straight into the existing "Generic MCP Server" UI with `Bearer <smithery-key>`. **I need to verify whether Smithery offers HTTP transport for this specific server** — I can check that during build, but if they don't, fall back to Option A.

### Option C — Skip MCP, call librosa directly from a Supabase edge function via a Python microservice
Same EC2 wrapper as Option A but expose plain REST endpoints. Cleanest if you don't actually need the MCP protocol — you only need the *capabilities*. This loses the "future MCP clients can introspect tools" benefit but is the least moving parts.

**My recommendation: Option A.** It keeps the abstraction your UI already supports, lets future LLM agents auto-discover the tools, and reuses your EC2 box.

---

## 📋 Build plan (assuming Option A)

### 1. Add `mcp_librosa` to the integration registry
Edit `src/config/integrations.ts` — append a new entry alongside `mcp_notion` / `mcp_linear`:

```ts
{
  id: "mcp_librosa",
  kind: "mcp",
  name: "Librosa Music Analysis MCP",
  description: "Audio feature extraction & beat tracking via the hugohow/mcp-music-analysis server (librosa under the hood).",
  docsUrl: "https://github.com/hugohow/mcp-music-analysis",
  setupSteps: [
    "On your EC2 box: `pip install uv && uv tool install mcp-music-analysis`.",
    "Install the bridge: `uv tool install mcp-proxy` (or build a tiny FastAPI wrapper).",
    "Run: `mcp-proxy --sse-port 8765 -- uvx mcp-music-analysis` (or your wrapper on a chosen port).",
    "Open the port (8765) in EC2 security group, ideally behind nginx + Bearer auth.",
    "Paste the public URL (e.g. https://your-ec2-host/librosa/sse) and Bearer token below.",
    "Click Test connection — performs a JSON-RPC `initialize` handshake.",
  ],
  fields: mcpFields,           // re-uses URL / scheme / token / extra-headers
  capabilities: [               // librosa-specific capability toggles
    { key: "feature.extract",  label: "Feature extraction", description: "tempo, mfcc, chroma_cqt", defaultEnabled: true },
    { key: "temporal.segment", label: "Temporal segmentation", description: "beat_track (more pending upstream)", defaultEnabled: true },
    { key: "audio.io",         label: "Audio loading & download", description: "load, download_from_url, download_from_youtube", defaultEnabled: true },
    { key: "utility.misc",     label: "Misc utilities", description: "get_duration etc.", defaultEnabled: true },
    // Disabled-by-default placeholders for what's NOT yet upstream:
    { key: "sequential.model",        label: "Sequential modeling (not yet available)", description: "Requires upstream PR.", defaultEnabled: false },
    { key: "utility.array",           label: "Array utilities (not yet available)",    description: "Requires upstream PR.", defaultEnabled: false },
    { key: "utility.matching",        label: "Matching utilities (not yet available)", description: "Requires upstream PR.", defaultEnabled: false },
    { key: "segment.laplacian",       label: "Laplacian segmentation (not yet available)", description: "Requires upstream PR.", defaultEnabled: false },
  ],
}
```
The disabled placeholder capabilities make the **gaps visible in your admin UI** rather than silently missing — when we fork/extend the server we just flip them on.

### 2. Allow-list the new ID in `admin-set-credentials`
Edit `supabase/functions/admin-set-credentials/index.ts` — extend `MCP_FIELDS` with the new capability keys (`MCP_CAP_FEATURE_EXTRACT`, etc.) and add `mcp_librosa: MCP_FIELDS` to `ALLOWED_FIELDS`.

### 3. Build a real MCP test endpoint (currently `mcp_*` integrations have no tester)
Create `supabase/functions/mcp-test/index.ts`:
- Reads `MCP_SERVER_URL` + `MCP_AUTH_SCHEME` + `MCP_AUTH_TOKEN` for the requested integration from `integration_credentials`
- Sends a JSON-RPC `initialize` request with required headers `Accept: application/json, text/event-stream` and `Content-Type: application/json` (per MCP Streamable HTTP spec — without these MCP servers return HTTP 406)
- Records latency + success in `integration_test_history`

Make it generic so it works for `mcp_librosa`, `mcp_notion`, `mcp_linear`, and `mcp_generic`. Then set `testEndpoint: "mcp-test"` on all four MCP entries in the registry. Bonus side-effect: this fixes the "Test (n/a)" state for your existing MCP entries.

### 4. Build a runtime invoker: `supabase/functions/mcp-call/index.ts`
A reusable edge function that:
- Takes `{ integration_id, tool_name, arguments }` as body
- Loads that integration's URL+auth from `integration_credentials`
- Issues a `tools/call` JSON-RPC request
- Returns the tool result to the client

This is what your future fingerprint pipeline will call when it wants to ask librosa for an MFCC.

### 5. (Optional, follow-up) Wire librosa into the analysis pipeline
Once the MCP is reachable, `analyze-audio` (or a sibling `analyze-audio-librosa`) can call `mcp-call` to enrich source analyses with real DSP features (tempo, chroma, MFCC) instead of relying solely on the LLM's perceptual scoring. Out of scope for this plan — flag for a separate task.

---

## ⚠️ State limitation you should know about

Every librosa tool except `load`/`download_*` requires a `path_audio_time_series_y` produced by a prior `load` call — and that file lives in **the MCP server's local `/tmp`**. So:
- ✅ Works fine if all calls in a single analysis hit the same EC2 instance (sticky session or single replica).
- ❌ Breaks if you ever scale horizontally without shared storage.
- 💡 If this becomes an issue, the upstream server needs to be patched to use S3 or pass arrays inline.

---

## 📂 Files to touch

| File | Action |
|---|---|
| `src/config/integrations.ts` | Add `mcp_librosa` entry; set `testEndpoint: "mcp-test"` on all MCP entries |
| `supabase/functions/admin-set-credentials/index.ts` | Add `mcp_librosa` to `ALLOWED_FIELDS`; extend `MCP_FIELDS` with new capability keys |
| `supabase/functions/mcp-test/index.ts` | **new** — generic MCP `initialize` handshake tester |
| `supabase/functions/mcp-call/index.ts` | **new** — generic `tools/call` invoker for runtime use |
| `supabase/config.toml` | Mark both new functions `verify_jwt = true` (admin/auth-gated) |

No DB migrations needed — `integration_credentials` already supports the new keys, and `integration_test_history` is already in place.

---

## ❓ Before I build, please confirm

1. **Hosting**: Are you OK with running the MCP server on your existing EC2 box (Option A)? If yes, I'll write a one-liner systemd unit + nginx snippet for you alongside the code. If you'd rather try Smithery first (Option B), I'll probe their HTTP endpoint during build.
2. **Capability gaps**: Are you OK shipping `mcp_librosa` with the 4 missing categories shown as disabled placeholders, with a follow-up task to fork the server and add them?
3. **Auth**: For the EC2 endpoint, plain Bearer token via nginx is simplest. Want anything stronger (mTLS, IP allow-list)?

Once you approve and answer those three, I'll implement everything in one pass.
// Provider registry for admin-managed third-party API integrations.
// To add a new provider: append an entry below + (optionally) create a `<testEndpoint>` edge function.

export type IntegrationFieldType = "text" | "password" | "textarea";
export type IntegrationKind = "rest" | "mcp";

export interface IntegrationField {
  key: string;            // stored as integration_credentials.field_key
  label: string;
  type: IntegrationFieldType;
  placeholder: string;
  helpText: string;
  required: boolean;
}

export interface IntegrationCapability {
  key: string;     // e.g. "tools.read", "resources.read"
  label: string;   // human-readable
  description: string;
  defaultEnabled: boolean;
}

export interface Integration {
  id: string;
  kind: IntegrationKind;     // "rest" = direct API, "mcp" = Model Context Protocol server
  name: string;
  description: string;
  docsUrl: string;
  setupSteps: string[];
  fields: IntegrationField[];
  testEndpoint?: string;     // edge function name; optional for providers without a tester yet
  capabilities?: IntegrationCapability[]; // primarily for MCP, but reusable
}

// ---------- Shared MCP credential shape ----------
// Every MCP integration uses the same three knobs: server URL, auth scheme, token.
const mcpFields: IntegrationField[] = [
  {
    key: "MCP_SERVER_URL",
    label: "MCP Server URL",
    type: "text",
    placeholder: "https://mcp.example.com/sse",
    helpText:
      "Streamable HTTP or SSE endpoint of the MCP server (typically ends in /sse, /mcp, or /mcp-server/http).",
    required: true,
  },
  {
    key: "MCP_AUTH_SCHEME",
    label: "Auth Scheme",
    type: "text",
    placeholder: "Bearer",
    helpText:
      "HTTP auth scheme prefixed to the token. Common values: Bearer, Token, ApiKey. Leave blank for no auth.",
    required: false,
  },
  {
    key: "MCP_AUTH_TOKEN",
    label: "Auth Token / API Key",
    type: "password",
    placeholder: "sk-... or personal access token",
    helpText:
      "Secret credential sent in the Authorization header. Stored encrypted; only edge functions can read it.",
    required: false,
  },
  {
    key: "MCP_HEADERS_JSON",
    label: "Extra Headers (JSON)",
    type: "textarea",
    placeholder: '{"X-Workspace-Id":"abc123"}',
    helpText:
      "Optional JSON object of additional headers (e.g. workspace IDs, tenant scoping). Leave blank if not needed.",
    required: false,
  },
];

const mcpCapabilities: IntegrationCapability[] = [
  {
    key: "tools.read",
    label: "List & invoke tools",
    description: "Allow the agent to discover and call MCP tools exposed by this server.",
    defaultEnabled: true,
  },
  {
    key: "resources.read",
    label: "Read resources",
    description: "Allow reading documents/resources the server exposes.",
    defaultEnabled: true,
  },
  {
    key: "prompts.read",
    label: "Use prompts",
    description: "Allow the agent to fetch prompt templates from the server.",
    defaultEnabled: false,
  },
  {
    key: "sampling.write",
    label: "Allow sampling callbacks",
    description: "Permit the server to request LLM completions through this app.",
    defaultEnabled: false,
  },
];

export const INTEGRATIONS: Integration[] = [
  // ===================== REST APIs =====================
  {
    id: "apple_music",
    kind: "rest",
    name: "Apple Music",
    description: "Search the Apple Music catalog and import tracks for analysis.",
    docsUrl: "https://developer.apple.com/documentation/applemusicapi",
    setupSteps: [
      "Enroll in the Apple Developer Program ($99/yr) at developer.apple.com.",
      "In the dev portal: Certificates, IDs & Profiles → Identifiers → register a new Media ID (e.g. media.com.yourapp).",
      "Go to Keys → create a new key, enable MusicKit, and download the .p8 private key file (only once!).",
      "Note your 10-character Team ID (top-right of the dev portal) and the Key ID (shown when you created the key).",
      "Paste the Team ID, Key ID, and the full contents of the .p8 file below, then click Test Connection.",
    ],
    fields: [
      {
        key: "APPLE_TEAM_ID",
        label: "Team ID",
        type: "text",
        placeholder: "ABCDE12345",
        helpText: "10-character alphanumeric ID, top-right of the Apple Developer portal.",
        required: true,
      },
      {
        key: "APPLE_KEY_ID",
        label: "Key ID",
        type: "text",
        placeholder: "ABCDE12345",
        helpText: "10-character ID shown when you created the MusicKit key.",
        required: true,
      },
      {
        key: "APPLE_PRIVATE_KEY",
        label: ".p8 Private Key",
        type: "textarea",
        placeholder: "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG...\n-----END PRIVATE KEY-----",
        helpText: "Paste the full contents of the AuthKey_XXXXX.p8 file, including BEGIN/END lines.",
        required: true,
      },
    ],
    testEndpoint: "apple-music-test",
  },
  {
    id: "spotify",
    kind: "rest",
    name: "Spotify",
    description: "Search the Spotify catalog and import 30-second previews for analysis.",
    docsUrl: "https://developer.spotify.com/documentation/web-api",
    setupSteps: [
      "Go to developer.spotify.com/dashboard and log in with your Spotify account.",
      "Click 'Create app' — name it anything (e.g. 'Lovable Audio Fingerprint').",
      "For Redirect URI you can enter http://localhost (we use Client Credentials flow, not OAuth).",
      "Open your new app → Settings → copy the Client ID and Client Secret.",
      "Paste them below and click Test Connection.",
    ],
    fields: [
      {
        key: "SPOTIFY_CLIENT_ID",
        label: "Client ID",
        type: "text",
        placeholder: "1a2b3c4d5e6f7g8h9i0j",
        helpText: "32-character hex string from your Spotify app settings.",
        required: true,
      },
      {
        key: "SPOTIFY_CLIENT_SECRET",
        label: "Client Secret",
        type: "password",
        placeholder: "••••••••••••••••",
        helpText: "Keep this secret. Reveal it once in the Spotify dashboard and paste here.",
        required: true,
      },
    ],
    // No dedicated tester yet — credentials are validated at runtime by spotify-search.
  },
  {
    id: "spotify_audio_features",
    kind: "rest",
    name: "Spotify Audio Features (Librosa fallback)",
    description:
      "Server-free audio analysis using Spotify's pre-computed features (tempo, key, energy, valence, danceability, etc.). Reuses the Spotify credentials configured above — no extra setup. Use this while the Librosa REST API is being deployed, or for Spotify-only catalogs.",
    docsUrl:
      "https://developer.spotify.com/documentation/web-api/reference/get-audio-features",
    setupSteps: [
      "Make sure the Spotify integration above is configured and verified.",
      "That's it — this card uses the same credentials. No new token to paste.",
      "Click Test Connection: it requests a fresh Spotify access token to confirm the creds are still valid and the /audio-features endpoint is reachable.",
      "Note: Spotify deprecated /audio-features for apps registered AFTER Nov 27, 2024. If your Spotify app is newer, the test will return spotify_unavailable=true and you'll need a grandfathered app or the Librosa REST fallback.",
    ],
    fields: [],
    testEndpoint: "spotify-audio-features-test",
  },
  {
    id: "librosa_rest",
    kind: "rest",
    name: "Librosa REST API",
    description:
      "Plain HTTP wrapper around the librosa analysis pipeline (sibling of the MCP server). Use this while MCP is being debugged — same EC2 box, simpler API.",
    docsUrl: "https://github.com/hugohow/mcp-music-analysis",
    setupSteps: [
      "On the EC2 box: cd ~/librosa-mcp && sudo ./install-rest.sh (after install.sh has already run).",
      "The script installs FastAPI + uvicorn into the existing /opt/librosa-mcp/.venv, generates a Bearer token, and starts the librosa-rest systemd service on 127.0.0.1:8766.",
      "Add the /librosa-rest/ location block from nginx-librosa-rest.conf to your existing nginx server (replacing TOKEN_GOES_HERE), then `sudo nginx -t && sudo systemctl reload nginx`.",
      "Verify from your laptop: `curl -H 'Authorization: Bearer <token>' https://YOUR_HOST/librosa-rest/health` should return `{\"ok\":true,...}`.",
      "Paste the base URL (without trailing /health) and the token below, then click Test Connection.",
    ],
    fields: [
      {
        key: "LIBROSA_REST_URL",
        label: "Base URL",
        type: "text",
        placeholder: "https://your-ec2-host/librosa-rest",
        helpText:
          "Base URL of the REST API, without trailing slash. The tester appends /health automatically.",
        required: true,
      },
      {
        key: "LIBROSA_REST_TOKEN",
        label: "Bearer Token",
        type: "password",
        placeholder: "64-char hex string from /etc/librosa-rest.token",
        helpText:
          "The token printed at the end of install-rest.sh. Sent as `Authorization: Bearer <token>`.",
        required: true,
      },
    ],
    testEndpoint: "librosa-rest-test",
  },
  {
    id: "semantic_svc",
    kind: "rest",
    name: "Semantic Service",
    description:
      "EC2 semantic-svc: CLAP/audio + text embeddings and ontology scoring used by the semantic analysis pipeline. Runs on the same box as Librosa, behind nginx with a Bearer token.",
    docsUrl: "https://sonicsimai.lovable.app/semantic-svc/bootstrap.sh",
    setupSteps: [
      "On the EC2 box: curl -fsSL https://sonicsimai.lovable.app/semantic-svc/bootstrap.sh | sudo bash — installs semantic-svc on 127.0.0.1:8769 as a systemd service.",
      "Add the /semantic/ location block (see deploy/semantic-svc/nginx-semantic-svc.conf) to the ACTIVE nginx vhost, keeping upstream + auth in /etc/nginx/conf.d/semantic-svc.conf, then `sudo nginx -t && sudo systemctl reload nginx`.",
      "Read the token: `sudo cat /etc/semantic-svc.token`.",
      "Verify: `curl -H 'Authorization: Bearer <token>' https://YOUR_HOST/semantic/healthz` returns `{\"ok\":true,...}`.",
      "Paste the base URL (ending in /semantic, no trailing slash) and the token below, then click Test Connection. Prefer https:// once inbound 443 is open on the security group.",
    ],
    fields: [
      {
        key: "SEMANTIC_SVC_URL",
        label: "Base URL",
        type: "text",
        placeholder: "https://your-ec2-host/semantic",
        helpText:
          "Base URL of the semantic service, without trailing slash. The tester appends /healthz automatically.",
        required: true,
      },
      {
        key: "SEMANTIC_SVC_TOKEN",
        label: "Bearer Token",
        type: "password",
        placeholder: "64-char hex string from /etc/semantic-svc.token",
        helpText:
          "Token enforced by the nginx /semantic/ block. Sent as `Authorization: Bearer <token>`.",
        required: true,
      },
    ],
    testEndpoint: "semantic-svc-test",
  },

  {
    id: "pandora",
    kind: "rest",
    name: "Pandora",
    description:
      "Search Pandora stations and tracks. Note: Pandora's API requires partner approval — see docs.",
    docsUrl: "https://6xq.net/pandora-apidoc/",
    setupSteps: [
      "Apply for Pandora API access at pandora.com/about/api (partner program — approval required).",
      "Once approved you'll receive a Partner Username, Partner Password, and Device ID.",
      "Use your Pandora account email and password as the User credentials.",
      "Paste all four values below, then click Test Connection once a tester edge function exists.",
    ],
    fields: [
      {
        key: "PANDORA_PARTNER_USERNAME",
        label: "Partner Username",
        type: "text",
        placeholder: "android",
        helpText: "Provided by Pandora when you're approved as a partner.",
        required: true,
      },
      {
        key: "PANDORA_PARTNER_PASSWORD",
        label: "Partner Password",
        type: "password",
        placeholder: "••••••••",
        helpText: "Partner-level shared secret. Treat as sensitive.",
        required: true,
      },
      {
        key: "PANDORA_DEVICE_ID",
        label: "Device ID",
        type: "text",
        placeholder: "android-generic",
        helpText: "Identifier string tied to the partner credentials.",
        required: true,
      },
      {
        key: "PANDORA_USER_EMAIL",
        label: "Account Email",
        type: "text",
        placeholder: "you@example.com",
        helpText: "Your Pandora account email used for user-level auth.",
        required: true,
      },
      {
        key: "PANDORA_USER_PASSWORD",
        label: "Account Password",
        type: "password",
        placeholder: "••••••••",
        helpText: "Your Pandora account password.",
        required: true,
      },
    ],
  },

  // ===================== MCP servers =====================
  {
    id: "mcp_generic",
    kind: "mcp",
    name: "Generic MCP Server",
    description:
      "Connect any Model Context Protocol server (Streamable HTTP / SSE). Use this for self-hosted or one-off MCPs.",
    docsUrl: "https://modelcontextprotocol.io/docs",
    setupSteps: [
      "Deploy or obtain the URL of an MCP server (e.g. a Supabase edge function using mcp-lite).",
      "If the server requires auth, generate an API token / personal access token from its admin panel.",
      "Pick the auth scheme (usually 'Bearer'). Leave blank for unauthenticated local servers.",
      "Paste the server URL + token below and select which capabilities the agent may use.",
      "Click Test Connection to perform a JSON-RPC `initialize` handshake.",
    ],
    fields: mcpFields,
    capabilities: mcpCapabilities,
  },
  {
    id: "mcp_notion",
    kind: "mcp",
    name: "Notion MCP",
    description: "Read pages and databases from a Notion workspace via its MCP server.",
    docsUrl: "https://developers.notion.com/docs/mcp",
    setupSteps: [
      "In Notion → Settings → Integrations → 'Develop or manage integrations' → New integration.",
      "Copy the Internal Integration Token (starts with `secret_` or `ntn_`).",
      "Share the Notion pages/databases you want exposed with the integration (… menu → Connections).",
      "Use Notion's hosted MCP URL (https://mcp.notion.com/sse) or your self-hosted endpoint.",
      "Paste the URL + token below, scheme 'Bearer'.",
    ],
    fields: mcpFields,
    capabilities: mcpCapabilities,
  },
  {
    id: "mcp_linear",
    kind: "mcp",
    name: "Linear MCP",
    description: "Query Linear issues, projects, and cycles via the Linear MCP server.",
    docsUrl: "https://linear.app/docs/mcp",
    setupSteps: [
      "In Linear → Settings → API → Personal API keys → Create key.",
      "Copy the key (shown only once).",
      "Use Linear's hosted MCP URL (https://mcp.linear.app/sse) or your self-hosted endpoint.",
      "Paste the URL + key below, scheme 'Bearer'.",
    ],
    fields: mcpFields,
    capabilities: mcpCapabilities,
  },
  {
    id: "mcp_librosa",
    kind: "mcp",
    name: "Librosa Music Analysis MCP",
    description:
      "Audio feature extraction & beat tracking via the hugohow/mcp-music-analysis server (librosa under the hood). Requires an HTTP/SSE bridge — the upstream server is stdio-only.",
    docsUrl: "https://github.com/hugohow/mcp-music-analysis",
    setupSteps: [
      "On your EC2 box: install uv → `pip install uv && uv tool install mcp-music-analysis`.",
      "Install the stdio→SSE bridge: `uv tool install mcp-proxy` (https://github.com/sparfenyuk/mcp-proxy).",
      "Run the bridge: `mcp-proxy --sse-port 8765 -- uvx mcp-music-analysis` (use systemd to keep it alive).",
      "Open the chosen port in your EC2 security group, ideally behind nginx + a Bearer token.",
      "Paste the public URL (e.g. https://your-ec2-host/librosa/sse) and Bearer token below, then Test Connection.",
    ],
    fields: mcpFields,
    testEndpoint: "mcp-test",
    capabilities: [
      {
        key: "feature.extract",
        label: "Feature extraction",
        description: "tempo, mfcc, chroma_cqt — core librosa.feature.* wrappers.",
        defaultEnabled: true,
      },
      {
        key: "temporal.segment",
        label: "Temporal segmentation",
        description: "beat_track. Onset detection / agglomerative segmentation pending upstream.",
        defaultEnabled: true,
      },
      {
        key: "audio.io",
        label: "Audio loading & download",
        description: "load, download_from_url, download_from_youtube.",
        defaultEnabled: true,
      },
      {
        key: "utility.misc",
        label: "Misc utilities",
        description: "get_duration and similar helpers.",
        defaultEnabled: true,
      },
      {
        key: "sequential.model",
        label: "Sequential modeling",
        description: "dtw, viterbi, viterbi_discriminative (Lovable fork).",
        defaultEnabled: true,
      },
      {
        key: "utility.array",
        label: "Array utilities",
        description: "util_frame, util_pad_center, util_normalize, util_stack_memory (Lovable fork).",
        defaultEnabled: true,
      },
      {
        key: "utility.matching",
        label: "Matching utilities",
        description: "util_match_events, util_match_intervals (Lovable fork).",
        defaultEnabled: true,
      },
      {
        key: "segment.laplacian",
        label: "Laplacian segmentation",
        description: "recurrence_matrix + full Brian McFee laplacian_segmentation pipeline (Lovable fork).",
        defaultEnabled: true,
      },
    ],
  },
  {
    id: "mcp_intuizi",
    kind: "mcp",
    name: "Intuizi Console MCP",
    description:
      "Drive the Intuizi console from SonicSIM Admin: browse projects, audiences, cohorts and POI data, estimate and build audiences, activate them to your S3 endpoint, then hand the delivered files straight to the ingest pipeline. Reads are open; creates and deletes stay behind the write toggle.",
    docsUrl: "https://console.intuizi.com/mcp/getting-started",
    setupSteps: [
      "In the Intuizi console: My Account → MCP Tokens → Generate new token. The token is shown once — copy it now.",
      "Headless alternative: POST https://console.intuizi.com/api/v2/auth/mcp-token with your console email + password; the token is in data.token.",
      "Server URL is prefilled (https://console.intuizi.com/api/v2/mcp) and the scheme is Bearer — leave both as-is unless Intuizi tells you otherwise.",
      "Paste the token below and click Test Connection (JSON-RPC initialize handshake, costs no API call).",
      "Leave 'Create & modify Intuizi resources' OFF until you actually want to build audiences or activations from here.",
      "Tokens last one year. Changing your Intuizi password revokes every MCP token and one-click connector immediately — re-paste a fresh token here if that happens.",
    ],
    fields: mcpFields.map((f) =>
      f.key === "MCP_SERVER_URL"
        ? {
            ...f,
            placeholder: "https://console.intuizi.com/api/v2/mcp",
            helpText:
              "Stateless Streamable HTTP endpoint of the Intuizi MCP server. Use the default unless Intuizi gives you a tenant-specific URL.",
          }
        : f.key === "MCP_AUTH_TOKEN"
          ? {
              ...f,
              label: "Intuizi MCP Token",
              placeholder: "MCP token from My Account → MCP Tokens",
              helpText:
                "Shown once in the Intuizi console. Stored encrypted; only edge functions read it, never the browser.",
              required: true,
            }
          : f,
    ),
    testEndpoint: "mcp-test",
    capabilities: [
      {
        key: "tools.read",
        label: "Read console data",
        description:
          "list/get audiences, activations, cohorts, projects, POI data, usage, reference catalogs, and size estimates.",
        defaultEnabled: true,
      },
      {
        key: "resources.read",
        label: "Read Intuizi docs resources",
        description:
          "Fetch the API contract pages the server publishes (envelope, async model, errors, idempotency). No account data, no API quota.",
        defaultEnabled: true,
      },
      {
        key: "tools.write",
        label: "Create & modify Intuizi resources",
        description:
          "Allows create_audience, create_activation, cohorts, projects, POI writes and the delete tools. Every call still needs an explicit in-app confirmation.",
        defaultEnabled: false,
      },
      {
        key: "prompts.read",
        label: "Use server prompts",
        description: "Fetch the build_and_activate_audience guided workflow prompt.",
        defaultEnabled: false,
      },
    ],
  },
];


// Wire the generic MCP tester to all MCP integrations (additive — doesn't break existing entries).
for (const integration of INTEGRATIONS) {
  if (integration.kind === "mcp" && !integration.testEndpoint) {
    integration.testEndpoint = "mcp-test";
  }
}

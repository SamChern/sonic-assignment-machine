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
        label: "Sequential modeling (not yet available)",
        description: "Requires forking the upstream MCP and adding @mcp.tool wrappers around librosa.sequence.*.",
        defaultEnabled: false,
      },
      {
        key: "utility.array",
        label: "Array utilities (not yet available)",
        description: "Requires upstream PR exposing librosa.util.* (frame, pad_center, normalize, ...).",
        defaultEnabled: false,
      },
      {
        key: "utility.matching",
        label: "Matching utilities (not yet available)",
        description: "Requires upstream PR exposing librosa.util.match_events / match_intervals.",
        defaultEnabled: false,
      },
      {
        key: "segment.laplacian",
        label: "Laplacian segmentation (not yet available)",
        description: "Requires upstream PR exposing recurrence_matrix + Laplacian decomposition pipeline.",
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

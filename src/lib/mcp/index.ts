import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listAnalysesTool from "./tools/list-analyses";
import getFingerprintTool from "./tools/get-fingerprint";
import listAudioSourcesTool from "./tools/list-audio-sources";
import searchTaxonomyTool from "./tools/search-taxonomy";

// The OAuth issuer must be the direct Supabase host, built from the project ref
// (inlined by Vite at build time so this module stays import-safe).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "sonicsimai",
  title: "SonicSIMai",
  version: "0.1.0",
  instructions:
    "Tools for SonicSIM, a semantic audio analysis platform. Every audio source is scored across six categories — emotional, cognitive, social, communication, contextual, artistic — and mapped onto a semantic taxonomy. Use `list_analyses` for the signed-in user's recent scored sources, `get_fingerprint` for their aggregate sonic fingerprint, `list_audio_sources` to see what is analyzed or pending, and `search_taxonomy` to explore ontology nodes and their grounding. All tools act as the signed-in user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listAnalysesTool, getFingerprintTool, listAudioSourcesTool, searchTaxonomyTool],
});

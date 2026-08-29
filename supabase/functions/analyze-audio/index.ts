import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  blendConfidence,
  fetchProviderFeatures,
  formatLibrosaProfile,
  formatProviderProfile,
  neighborPrior,
  type EvidenceKind,
} from '../_shared/evidence.ts';
import { chatCompletion, GatewayError, stableHash } from '../_shared/inference.ts';
import {
  buildNeighborExemplars,
  CATALOG_DIMS,
  describeBridge,
  describeTagSubject,
  type NeighborExemplar,
  padToCatalog,
  pickBridgeRoute,
  type TaxonomyNodeVectors,
  weightedTagVector,
} from '../_shared/context.ts';
import { clapBridge, getSemanticSvcConfig } from '../_shared/semanticSvc.ts';
import { controlNumber } from '../_shared/control.ts';


/**
 * Step 4 — take a subject vector into the catalog space (`vector(1536)`) so
 * `match_audio_profiles` can be used regardless of which embedding space the
 * subject's tags came from. Prefers a trained bridge from `embedding_bridges`
 * (applied by the semantic service), falling back to deterministic tiling.
 */
async function toCatalogVector(
  // deno-lint-ignore no-explicit-any
  admin: any,
  vector: number[],
): Promise<{ vector: number[]; route: string; audit: string } | null> {
  if (!Array.isArray(vector) || vector.length === 0) return null;
  if (vector.length === CATALOG_DIMS) {
    return { vector, route: 'native', audit: describeBridge('native', vector.length) };
  }

  let bridge: { id?: string; name?: string; from_dim?: number; to_dim?: number; weights_url?: string | null } | null =
    null;
  try {
    const { data } = await admin
      .from('embedding_bridges')
      .select('id, name, from_dim, to_dim, weights_url')
      .eq('is_active', true)
      .eq('from_dim', vector.length)
      .eq('to_dim', CATALOG_DIMS)
      .limit(1)
      .maybeSingle();
    bridge = data ?? null;
  } catch (e) {
    console.warn('embedding_bridges lookup failed:', e);
  }

  const route = pickBridgeRoute(vector.length, bridge);
  if (route === 'bridge') {
    const cfg = await getSemanticSvcConfig(admin);
    if (cfg) {
      const out = await clapBridge(cfg, [vector], bridge?.id ?? null, bridge?.weights_url ?? null);
      const projected = out?.vectors?.[0];
      if (Array.isArray(projected) && projected.length === CATALOG_DIMS) {
        return {
          vector: projected,
          route: 'bridge',
          audit: describeBridge('bridge', vector.length, bridge?.name ?? null),
        };
      }
    }
    console.warn('bridge unavailable, falling back to deterministic padding');
  }

  const padded = padToCatalog(vector);
  if (padded.length !== CATALOG_DIMS) return null;
  return { vector: padded, route: 'pad', audit: describeBridge('pad', vector.length) };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

interface AudioSource {
  name: string;
  type: 'file' | 'track';
  audio_source_id?: string;
  spotify_id?: string; // For cache key lookup
  /** Optional direct audio location. When absent the tag-only path is used. */
  file_url?: string | null;
  acoustic_profile?: string; // Optional pre-formatted acoustic summary
  taxonomy_context?: string; // Optional CTV taxonomy + calibration prior block
  /** Phase 2 — which evidence tier produced `acoustic_profile`. */
  evidence?: EvidenceKind;
  /** Hash of the acoustic/taxonomy evidence actually used for scoring. */
  feature_hash?: string;
  /** Step 4 — retrieved kNN exemplars recorded per call. */
  context_neighbors?: NeighborExemplar[];
  /** Step 4 — true when scored from tag embeddings, no librosa involved. */
  tag_only?: boolean;
}


interface AnalysisRequest {
  sources: AudioSource[];
  user_id?: string;
  save_results?: boolean;
  /**
   * Step 4 verification only: skip both cache tiers so a re-score exercises the
   * live scoring path. Defaults to false, so existing callers are unaffected.
   */
  bypass_cache?: boolean;
}


interface CategoryResult {
  name: string;
  score: number;
  description: string;
}

interface SourceResult {
  name: string;
  categories: CategoryResult[];
}

interface CachedSource {
  source_key: string;
  source_name: string;
  emotional_score: number;
  cognitive_score: number;
  social_score: number;
  communication_score: number;
  contextual_score: number;
  artistic_score: number;
  emotional_desc: string | null;
  cognitive_desc: string | null;
  social_desc: string | null;
  communication_desc: string | null;
  contextual_desc: string | null;
  artistic_desc: string | null;
}

// Generate a cache key for a source
function getCacheKey(source: AudioSource): string {
  if (source.spotify_id) {
    return `spotify:${source.spotify_id}`;
  }
  // For files, use normalized name as key
  return `file:${source.name.toLowerCase().trim()}`;
}

// Convert cached data to SourceResult format
function cachedToSourceResult(cached: CachedSource): SourceResult {
  return {
    name: cached.source_name,
    categories: [
      { name: 'Emotional', score: cached.emotional_score, description: cached.emotional_desc || '' },
      { name: 'Cognitive', score: cached.cognitive_score, description: cached.cognitive_desc || '' },
      { name: 'Social', score: cached.social_score, description: cached.social_desc || '' },
      { name: 'Communication', score: cached.communication_score, description: cached.communication_desc || '' },
      { name: 'Contextual', score: cached.contextual_score, description: cached.contextual_desc || '' },
      { name: 'Artistic', score: cached.artistic_score, description: cached.artistic_desc || '' },
    ],
  };
}

function stripMarkdownCodeFences(text: string): string {
  let t = text.trim();
  if (t.startsWith('```')) {
    // Remove opening fence like ```json or ```
    t = t.replace(/^```[a-zA-Z]*\n?/, '');
    // Remove trailing fence
    t = t.replace(/```\s*$/, '');
  }
  return t.trim();
}

// Repairs common LLM JSON breakage: unescaped double-quotes inside string values.
function escapeUnescapedQuotesInJsonStrings(text: string): string {
  let out = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      out += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escape = true;
      continue;
    }

    if (ch === '"') {
      if (!inString) {
        inString = true;
        out += ch;
        continue;
      }

      // We're inside a JSON string. Decide if this is a closing quote or an internal (unescaped) quote.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      const next = text[j];

      const isLikelyClosing = next === ':' || next === ',' || next === '}' || next === ']' || next === undefined;
      if (isLikelyClosing) {
        inString = false;
        out += ch;
      } else {
        // Internal quote → escape it.
        out += '\\"';
      }
      continue;
    }

    out += ch;
  }

  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      sources,
      user_id,
      save_results = false,
      bypass_cache = false,
    }: AnalysisRequest = await req.json();

    if (!sources || sources.length === 0) {
      throw new Error('No audio sources provided');
    }

    // Not fatal on its own: when an EC2 inference server is configured the
    // gateway key is only used as a fallback.
    if (!LOVABLE_API_KEY) {
      console.warn('LOVABLE_API_KEY is not set — relying on the EC2 inference server');
    }

    console.log(`Analyzing ${sources.length} audio source(s):`, sources);
    console.log(`User ID: ${user_id}, Save results: ${save_results}`);

    // Initialize Supabase client for cache operations
    const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY 
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;

    // Control Room knobs (60s cached; fall back to the shipped defaults).
    const knnK = Math.round(
      await controlNumber(supabaseAdmin, 'knn.k', 5, { min: 1, max: 32 }),
    );

    // === OPTIMIZATION 1: Check cache for existing analyses ===
    const cachedResults: SourceResult[] = [];
    const uncachedSources: AudioSource[] = [];
    const cacheKeyMap = new Map<string, AudioSource>();

    if (supabaseAdmin && !bypass_cache) {
      // Build cache keys for all sources
      const cacheKeys = sources.map(s => {
        const key = getCacheKey(s);
        cacheKeyMap.set(key, s);
        return key;
      });

      console.log('Checking cache for keys:', cacheKeys);

      // Query cache for existing analyses
      const { data: cachedData, error: cacheError } = await supabaseAdmin
        .from('source_cache')
        .select('*')
        .in('source_key', cacheKeys);

      if (cacheError) {
        console.error('Cache lookup error:', cacheError);
      } else if (cachedData && cachedData.length > 0) {
        console.log(`Found ${cachedData.length} cached analyses`);
        
        const cachedKeySet = new Set(cachedData.map(c => c.source_key));
        
        // Separate cached vs uncached
        for (const source of sources) {
          const key = getCacheKey(source);
          if (cachedKeySet.has(key)) {
            const cached = cachedData.find(c => c.source_key === key);
            if (cached) {
              cachedResults.push(cachedToSourceResult(cached));
            }
          } else {
            uncachedSources.push(source);
          }
        }
      } else {
        // No cache hits, all sources need analysis
        uncachedSources.push(...sources);
      }
    } else {
      // No Supabase client, analyze all
      uncachedSources.push(...sources);
    }

    console.log(`Cache hits: ${cachedResults.length}, Need analysis: ${uncachedSources.length}`);

    // === Only call AI if we have uncached sources ===
    let freshResults: SourceResult[] = [];

    if (uncachedSources.length > 0) {
      // === PHASE 2: resolve the best available acoustic evidence ===
      // Librosa is an enrichment, not a dependency. Tiers, best first:
      // librosa (cached measurements) -> provider audio features (Spotify) ->
      // nearest-neighbour prior over profile_embedding -> metadata only.
      if (supabaseAdmin) {
        // Step 4 — a subject with taxonomy context but no audio location is
        // scored from its tag embeddings. It never touches the librosa branch.
        for (const s of uncachedSources) {
          s.tag_only = !!s.taxonomy_context && !s.file_url;
        }

        // Tier 1 — cached librosa features (audio-backed subjects only).
        const ids = uncachedSources
          .filter(s => !s.tag_only)
          .map(s => s.audio_source_id)
          .filter(Boolean) as string[];
        if (ids.length > 0) {
          const { data: featRows } = await supabaseAdmin
            .from('audio_sources')
            .select('id, librosa_features')
            .in('id', ids);
          const byId = new Map((featRows ?? []).map(r => [r.id, r.librosa_features]));
          for (const s of uncachedSources) {
            if (!s.audio_source_id || s.tag_only) continue;
            const profile = formatLibrosaProfile(byId.get(s.audio_source_id));
            if (profile) {
              s.acoustic_profile = profile;
              s.evidence = 'librosa';
            }
          }
        }

        // Tier 2 — provider-supplied audio features (never touches EC2).
        const needProvider = uncachedSources.filter(
          s => !s.acoustic_profile && s.spotify_id && !s.tag_only,
        );
        if (needProvider.length > 0) {
          const providerMap = await fetchProviderFeatures(
            needProvider.map(s => s.spotify_id!) as string[],
          );
          for (const s of needProvider) {
            const f = s.spotify_id ? providerMap.get(s.spotify_id) : undefined;
            if (f) {
              s.acoustic_profile = formatProviderProfile(f);
              s.evidence = 'provider';
            }
          }
        }

        // Step 4 — tag-only subject vectors: weight-normalized sum of tag
        // embeddings, preferring grounded CLAP `audio_embedding` per node.
        for (const s of uncachedSources) {
          if (!s.tag_only || !s.audio_source_id) continue;
          try {
            const { data: tagRows } = await supabaseAdmin
              .from('audio_source_tags')
              .select('weight, taxonomy_nodes(id, code, label, embedding, audio_embedding, grounding_count)')
              .eq('audio_source_id', s.audio_source_id);
            const nodes: TaxonomyNodeVectors[] = (tagRows ?? [])
              // deno-lint-ignore no-explicit-any
              .map((r: any) => (r.taxonomy_nodes ? { ...r.taxonomy_nodes, weight: r.weight } : null))
              .filter(Boolean) as TaxonomyNodeVectors[];
            if (nodes.length === 0) continue;
            const subject = weightedTagVector(nodes);
            s.taxonomy_context = [s.taxonomy_context, describeTagSubject(nodes, subject)]
              .filter(Boolean)
              .join(' ');

            // kNN exemplars from the subject vector. Grounded CLAP tags are
            // 512-d, so bridge (or deterministically pad) into the catalog
            // space instead of skipping retrieval entirely.
            const bridged = subject ? await toCatalogVector(supabaseAdmin, subject.vector) : null;
            if (bridged) {
              s.taxonomy_context = [s.taxonomy_context, bridged.audit].filter(Boolean).join(' ');
              const { data: knn } = await supabaseAdmin.rpc('match_audio_profiles', {
                query_embedding: bridged.vector,
                match_count: knnK,
                exclude_id: s.audio_source_id,
              });
              const ctx = buildNeighborExemplars(knn as unknown[] as Record<string, unknown>[]);
              if (ctx.exemplars.length > 0) {
                s.context_neighbors = ctx.exemplars;
                s.taxonomy_context = [s.taxonomy_context, ctx.text].filter(Boolean).join(' ');
                s.evidence = 'neighbors';
              }
            }
          } catch (e) {
            console.error('Tag-only subject vector failed:', e);
          }
        }

        // Tier 3 — CaMML-style exemplars from the nearest analyzed sources.
        const needNeighbors = uncachedSources.filter(
          s => !s.acoustic_profile && s.audio_source_id && !s.context_neighbors,
        );
        for (const s of needNeighbors) {
          try {
            const { data: row } = await supabaseAdmin
              .from('audio_sources')
              .select('profile_embedding')
              .eq('id', s.audio_source_id!)
              .maybeSingle();
            const embedding = row?.profile_embedding;
            if (embedding) {
              const { data: knn } = await supabaseAdmin.rpc('match_audio_profiles', {
                query_embedding: embedding,
                match_count: knnK,
                exclude_id: s.audio_source_id,
              });
              const ctx = buildNeighborExemplars(knn as unknown[] as Record<string, unknown>[]);
              if (ctx.exemplars.length > 0) {
                s.context_neighbors = ctx.exemplars;
                s.taxonomy_context = [s.taxonomy_context, ctx.text].filter(Boolean).join(' ');
                s.evidence = 'neighbors';
                continue;
              }
            }
          } catch (e) {
            console.error('Exemplar retrieval failed:', e);
          }
          // Fallback to the legacy aggregate prior when kNN yields nothing.
          const prior = await neighborPrior(supabaseAdmin, s.audio_source_id!);
          if (prior) {
            s.taxonomy_context = [s.taxonomy_context, prior.text].filter(Boolean).join(' ');
            s.evidence = 'neighbors';
          }
        }


        for (const s of uncachedSources) if (!s.evidence) s.evidence = 'none';
        console.log(
          'Evidence tiers:',
          uncachedSources.reduce((acc, s) => {
            acc[s.evidence!] = (acc[s.evidence!] ?? 0) + 1;
            return acc;
          }, {} as Record<string, number>),
        );
      }


      // === Semantic score cache keyed by ACOUSTIC FEATURE HASH ===
      // Two different names with identical measured evidence produce the same
      // semantic profile, so we never pay for a second model call. This is what
      // stops re-analysis from re-prompting the LLM.
      for (const s of uncachedSources) {
        s.feature_hash = await stableHash({
          v: 2,
          evidence: s.evidence ?? 'none',
          acoustic: s.acoustic_profile ?? null,
          taxonomy: s.taxonomy_context ?? null,
          exemplars: (s.context_neighbors ?? []).map(n => `${n.id}:${n.similarity}`),
        });
      }


      let toAnalyze = uncachedSources;
      if (supabaseAdmin && !bypass_cache) {
        // Only evidence-backed hashes are trustworthy; a metadata-only source is
        // identified by its name alone and must not borrow another's score.
        const hashable = uncachedSources.filter(
          s => s.feature_hash && s.evidence && s.evidence !== 'none',
        );
        if (hashable.length > 0) {
          const { data: featCache } = await supabaseAdmin
            .from('source_cache')
            .select('*')
            .in('feature_hash', hashable.map(s => s.feature_hash!));
          const byHash = new Map(
            (featCache ?? []).map((row: CachedSource & { feature_hash: string }) => [
              row.feature_hash,
              row,
            ]),
          );
          if (byHash.size > 0) {
            const stillNeeded: AudioSource[] = [];
            for (const src of uncachedSources) {
              const hit = src.feature_hash ? byHash.get(src.feature_hash) : undefined;
              if (hit && src.evidence && src.evidence !== 'none') {
                // Reuse the scores, but keep the requested source's own name.
                cachedResults.push({ ...cachedToSourceResult(hit as CachedSource), name: src.name });
              } else {
                stillNeeded.push(src);
              }
            }
            console.log(
              `Feature-hash cache hits: ${uncachedSources.length - stillNeeded.length}`,
            );
            toAnalyze = stillNeeded;
          }
        }
      }

      // Batch sources to avoid truncation (max 5 per batch)
      const BATCH_SIZE = 5;
      const batches: AudioSource[][] = [];
      for (let i = 0; i < toAnalyze.length; i += BATCH_SIZE) {
        batches.push(toAnalyze.slice(i, i + BATCH_SIZE));
      }

      console.log(`Processing ${toAnalyze.length} sources in ${batches.length} batch(es)`);

      for (const batch of batches) {
        const sourcesList = batch
          .map(s => {
            const lines = [`- ${s.name}`];
            if (s.acoustic_profile) lines.push(`    acoustic: ${s.acoustic_profile}`);
            if (s.taxonomy_context) lines.push(`    taxonomy: ${s.taxonomy_context}`);
            return lines.join('\n');
          })
          .join('\n');

        
        const systemPrompt = `You are an expert audio semantic analyzer implementing the SemanticAC framework.

CRITICAL: Return ONLY valid JSON, no markdown code fences.

OUTPUT FORMAT:
{"sources":[{"name":"SOURCE NAME","categories":[{"name":"Emotional","score":75,"description":"brief analysis"},{"name":"Cognitive","score":60,"description":"brief analysis"},{"name":"Social","score":50,"description":"brief analysis"},{"name":"Communication","score":70,"description":"brief analysis"},{"name":"Contextual","score":65,"description":"brief analysis"},{"name":"Artistic","score":80,"description":"brief analysis"}]}]}

SCORING CALIBRATION - USE THE FULL 0-100 RANGE:
- 0-20: Minimal/absent - the category is barely relevant to this source
- 21-40: Weak - the category has minor presence but is not defining
- 41-60: Moderate - the category is present but not a primary characteristic
- 61-80: Strong - the category is a notable strength of this source
- 81-100: Exceptional - the category is a defining feature of this source

CRITICAL SCORING RULES:
- Scores MUST average around 50 across all categories for each source
- Every source should have at least one category below 35 AND one above 65
- If a source lacks emotional depth, give Emotional a LOW score (10-30), not 50+
- If a source is not particularly cerebral, give Cognitive a LOW score (10-30)
- Do NOT cluster all scores in the 60-80 range - this defeats the purpose
- Differentiate aggressively between sources - no two sources should have similar profiles

OTHER RULES:
- Return ONLY the JSON object, no markdown
- Do NOT include any double quotes (") inside description text; use single quotes
- Keep descriptions SHORT (under 40 words each)
- Each source MUST have exactly 6 categories
- Scores are 0-100 integers
- Use the EXACT source names provided
- When an "acoustic:" line is provided for a source, treat it as ground-truth
  measurement. It starts with source=librosa (tempo BPM, key/mode, beat
  regularity, onset rate, RMS energy, spectral centroid/rolloff/flatness,
  zero-crossing rate, spectral contrast bands, MFCC[0..6], dominant_pitches,
  chroma[12], tonnetz[6]) or source=spotify (tempo, key/mode, time signature,
  energy, valence, danceability, acousticness, instrumentalness, liveness,
  speechiness, loudness). Both are valid evidence — reason from whichever
  fields are present and never assume missing fields.
  Use them to inform Emotional (energy/valence, RMS, centroid + mode:
  minor/low-tonnetz-magnitude → melancholy/introspective; major/bright →
  uplifting), Cognitive (rhythmic regularity, harmonic complexity = chroma
  entropy + tonnetz spread; flatter chroma distribution = more harmonically
  complex/cerebral; low danceability + high instrumentalness = more cerebral),
  Artistic (timbre/MFCC variety, spectral contrast, tonnetz variance,
  acousticness), Communication (clear dominant pitches + strong key, or high
  speechiness = more direct/accessible), Social (danceability, liveness), and
  Contextual (tempo + flatness + key stability) scores. Do not echo the raw
  numbers in descriptions — translate them into qualitative language.
- When a "taxonomy:" line is provided, it lists CTV content tags plus prior
  mean ± std for each of the 6 categories learned from past analyses of
  similarly tagged sources, and/or a "prior[...]" block derived from the
  nearest already-analyzed sources (nearest_neighbors / avg_similarity).
  Treat those priors as a Bayesian anchor — your scores should stay within
  ~1 std of the prior unless the acoustics clearly contradict it. This keeps
  scores comparable across the catalog.
- When "exemplarN(similarity=... emotional=... tags=[...])" entries appear, they
  are retrieved few-shot examples: real already-scored sources with their cosine
  similarity to this subject. Weight each exemplar by its similarity — a 0.9
  neighbour is strong evidence, a 0.4 neighbour is weak. Interpolate between the
  exemplars rather than copying any single one, and deviate when the acoustic
  line or tags clearly differ.
- When a "subject=tags_only" line appears there is NO audio for this subject.
  Score entirely from the tag weights and exemplars: heavier tag weights
  dominate the profile, spoken-word/talk tags raise Communication and lower
  Artistic, and stay closer to the exemplar range since acoustics are unknown.
- If a source has neither an "acoustic:" nor a "taxonomy:" line, score it from
  its name and genre knowledge alone and stay closer to moderate values; the
  system records lower confidence for those.`;




        const userPrompt = `Analyze these ${batch.length} audio source${batch.length > 1 ? 's' : ''}:

${sourcesList}

For each source, determine its unique ontological profile. Be AGGRESSIVE in scoring:
- What categories define this source? Score those 70-95.
- What categories are weak/absent? Score those 10-35.
- Average across all 6 categories should be near 50, not 70+.

Return JSON with "sources" array. Each source needs: name (exact match), categories array with Emotional, Cognitive, Social, Communication, Contextual, Artistic (each with name, score 0-100, description).`;

        let analysisText = '';
        try {
          const completion = await chatCompletion(
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            { temperature: 0.2, maxTokens: 4000 },
          );
          analysisText = completion.text;
          console.log(`Scored batch via ${completion.provider} (${completion.model})`);
        } catch (e) {
          if (e instanceof GatewayError) {
            if (e.status === 429) {
              return new Response(
                JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
                { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
              );
            }
            if (e.status === 402 || e.status === 403) {
              return new Response(
                JSON.stringify({
                  error:
                    e.status === 402
                      ? 'Payment required. Please add credits to your workspace.'
                      : 'AI access is blocked by workspace policy.',
                  details: e.message,
                }),
                { status: e.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
              );
            }
            console.error('AI gateway error:', e.status, e.message);
            return new Response(JSON.stringify({ error: 'AI analysis failed', details: e.message }), {
              status: 502,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          console.error('Inference error:', e);
          return new Response(
            JSON.stringify({
              error: 'AI analysis failed',
              details: e instanceof Error ? e.message : String(e),
            }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }

        console.log('Raw AI response length:', analysisText.length);

        // Parse JSON response with improved handling
        let analysisResult: { sources: SourceResult[] };
        try {
          // Normalize to plain JSON text
          let jsonText = stripMarkdownCodeFences(analysisText);

          // If the model added pre/post text, try to isolate the JSON object
          if (!jsonText.startsWith('{')) {
            const start = jsonText.indexOf('{');
            const end = jsonText.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
              jsonText = jsonText.slice(start, end + 1);
            }
          }

          // Try to parse
          try {
            analysisResult = JSON.parse(jsonText);
          } catch (firstError) {
            console.log('First parse attempt failed, trying to repair JSON...');

            // Repair common failure: unescaped quotes inside string values
            const repairedText = escapeUnescapedQuotesInJsonStrings(jsonText);

            try {
              analysisResult = JSON.parse(repairedText);
            } catch {
              // Try to find and extract just the sources array
              const sourcesMatch = repairedText.match(/"sources"\s*:\s*\[/);
              if (sourcesMatch) {
                // Find balanced brackets
                let depth = 0;
                let inString = false;
                let escape = false;
                const start = repairedText.indexOf('[', sourcesMatch.index);
                let end = start;

                for (let i = start; i < repairedText.length; i++) {
                  const char = repairedText[i];
                  if (escape) {
                    escape = false;
                    continue;
                  }
                  if (char === '\\') {
                    escape = true;
                    continue;
                  }
                  if (char === '"') {
                    inString = !inString;
                    continue;
                  }
                  if (inString) continue;

                  if (char === '[') depth++;
                  if (char === ']') {
                    depth--;
                    if (depth === 0) {
                      end = i + 1;
                      break;
                    }
                  }
                }

                if (depth === 0 && end > start) {
                  const sourcesArray = repairedText.slice(start, end);
                  analysisResult = JSON.parse(`{"sources":${sourcesArray}}`);
                  console.log('JSON repair successful (sources-only)');
                } else {
                  throw new Error('Could not repair JSON - unbalanced brackets');
                }
              } else {
                throw firstError;
              }
            }
          }

          if (!analysisResult.sources || !Array.isArray(analysisResult.sources)) {
            console.error('Invalid response structure - missing sources array');
            throw new Error('Invalid response structure');
          }

          // Validate and clean up
          for (const source of analysisResult.sources) {
            source.name = source.name.replace(/\s*\((track|file)\)\s*$/i, '').trim();

            // Ensure we have 6 categories, fill in missing ones
            const categoryNames = ['Emotional', 'Cognitive', 'Social', 'Communication', 'Contextual', 'Artistic'];
            const existingCategories = new Map(source.categories?.map(c => [c.name, c]) || []);

            source.categories = categoryNames.map(name => {
              const existing = existingCategories.get(name);
              if (existing) {
                return { name, score: existing.score || 50, description: existing.description || '' };
              }
              return { name, score: 50, description: 'Analysis not available' };
            });
          }

          freshResults.push(...analysisResult.sources);
        } catch (parseError) {
          console.error('Failed to parse AI response:', parseError);
          console.error('Response text (first 500 chars):', analysisText.substring(0, 500));

          // If this is the only batch, return error; otherwise continue with other batches
          if (batches.length === 1) {
            return new Response(
              JSON.stringify({
                error: 'Failed to parse AI response as JSON. Please try again with fewer sources.',
              }),
              {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              },
            );
          } else {
            console.log('Continuing with other batches despite parse error');
          }
        }
      }

      // === OPTIMIZATION 1b: Store fresh results in cache ===
      // A bypassed run is a verification re-score and must not write the cache.
      if (supabaseAdmin && !bypass_cache && freshResults.length > 0) {

        const cacheInserts = freshResults.map(result => {
          const originalSource = uncachedSources.find(s => s.name === result.name);
          const cacheKey = originalSource ? getCacheKey(originalSource) : `file:${result.name.toLowerCase().trim()}`;
          const sourceType = originalSource?.spotify_id ? 'spotify' : 'file';
          
          const categories = result.categories.reduce((acc, cat) => {
            const key = cat.name.toLowerCase();
            acc[`${key}_score`] = cat.score;
            acc[`${key}_desc`] = cat.description;
            return acc;
          }, {} as Record<string, any>);

          return {
            source_key: cacheKey,
            source_type: sourceType,
            source_name: result.name,
            feature_hash: originalSource?.feature_hash ?? null,
            ...categories,
          };
        });

        console.log(`Caching ${cacheInserts.length} new analyses`);
        
        const { error: cacheInsertError } = await supabaseAdmin
          .from('source_cache')
          .upsert(cacheInserts, { onConflict: 'source_key' });

        if (cacheInsertError) {
          console.error('Cache insert error:', cacheInsertError);
        }
      }
    }

    // Combine cached and fresh results
    const allResults = [...cachedResults, ...freshResults];
    console.log(`Total results: ${allResults.length} (${cachedResults.length} cached, ${freshResults.length} fresh)`);

    // === OPTIMIZATION 2: Batch database operations ===
    let fingerprint = null;
    if (user_id && save_results && supabaseAdmin) {
      console.log('Saving analysis results for user:', user_id);

      // Create a map of source names to their audio_source_ids
      const sourceIdMap = new Map<string, string | undefined>();
      sources.forEach(s => {
        sourceIdMap.set(s.name, s.audio_source_id);
      });

      // Build batch insert data — including a per-source `confidence` value
      // derived from the variance of the 6 category scores.
      // High variance = decisive AI scoring = high confidence (clamped 0.1–1.0).
      const insertData = allResults.map(sourceResult => {
        const categories = sourceResult.categories.reduce((acc, cat) => {
          const key = cat.name.toLowerCase();
          acc[`${key}_score`] = cat.score;
          acc[`${key}_desc`] = cat.description;
          return acc;
        }, {} as Record<string, any>);

        // Compute confidence from category-score spread
        const scores = sourceResult.categories.map(c => Number(c.score) || 0);
        const mean = scores.reduce((s, v) => s + v, 0) / (scores.length || 1);
        const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / (scores.length || 1);
        const stddev = Math.sqrt(variance);
        const spread = Math.max(0.1, Math.min(1, stddev / 30));
        // Phase 2 — weight confidence by the acoustic evidence tier that was
        // actually available (librosa > provider > neighbours > metadata).
        const matched = uncachedSources.find(s => s.name === sourceResult.name);
        const evidence = matched?.evidence ?? 'librosa'; // cached analyses kept their own evidence
        const confidence = blendConfidence(spread, evidence);


        return {
          user_id,
          audio_source_id: sourceIdMap.get(sourceResult.name) || null,
          source_name: sourceResult.name,
          confidence,
          context_neighbors: matched?.context_neighbors ?? null,
          ...categories,
        };

      });

      // Single bulk insert instead of N individual inserts
      const { error: insertError } = await supabaseAdmin
        .from('source_analyses')
        .insert(insertData);

      if (insertError) {
        console.error('Error batch inserting source analyses:', insertError);
      } else {
        console.log(`Batch inserted ${insertData.length} analyses`);
      }

      // Only recalculate fingerprint if we inserted data
      if (!insertError && insertData.length > 0) {
        const { error: rpcError } = await supabaseAdmin
          .rpc('recalculate_user_fingerprint', { p_user_id: user_id });

        if (rpcError) {
          console.error('Error recalculating fingerprint:', rpcError);
        } else {
          const { data: fpData } = await supabaseAdmin
            .from('user_fingerprints')
            .select('*')
            .eq('user_id', user_id)
            .single();

          fingerprint = fpData;
          console.log('Updated fingerprint:', fingerprint);
        }
      }
    }

    return new Response(JSON.stringify({ 
      sources: allResults,
      fingerprint,
      cache_stats: {
        cached: cachedResults.length,
        fresh: freshResults.length,
      },
      evidence_stats: uncachedSources.reduce((acc, s) => {
        const k = s.evidence ?? 'none';
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),

    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-audio function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

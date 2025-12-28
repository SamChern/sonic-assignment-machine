import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
}

interface AnalysisRequest {
  sources: AudioSource[];
  user_id?: string;
  save_results?: boolean;
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
    const { sources, user_id, save_results = false }: AnalysisRequest = await req.json();

    if (!sources || sources.length === 0) {
      throw new Error('No audio sources provided');
    }

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log(`Analyzing ${sources.length} audio source(s):`, sources);
    console.log(`User ID: ${user_id}, Save results: ${save_results}`);

    // Initialize Supabase client for cache operations
    const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY 
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;

    // === OPTIMIZATION 1: Check cache for existing analyses ===
    const cachedResults: SourceResult[] = [];
    const uncachedSources: AudioSource[] = [];
    const cacheKeyMap = new Map<string, AudioSource>();

    if (supabaseAdmin) {
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
      // Batch sources to avoid truncation (max 5 per batch)
      const BATCH_SIZE = 5;
      const batches: AudioSource[][] = [];
      for (let i = 0; i < uncachedSources.length; i += BATCH_SIZE) {
        batches.push(uncachedSources.slice(i, i + BATCH_SIZE));
      }

      console.log(`Processing ${uncachedSources.length} sources in ${batches.length} batch(es)`);

      for (const batch of batches) {
        const sourcesList = batch.map(s => `- ${s.name}`).join('\n');
        
        const systemPrompt = `You are an expert audio semantic analyzer implementing the SemanticAC framework.

CRITICAL: Return ONLY valid JSON, no markdown code fences.

OUTPUT FORMAT:
{"sources":[{"name":"SOURCE NAME","categories":[{"name":"Emotional","score":75,"description":"brief analysis"},{"name":"Cognitive","score":60,"description":"brief analysis"},{"name":"Social","score":50,"description":"brief analysis"},{"name":"Communication","score":70,"description":"brief analysis"},{"name":"Contextual","score":65,"description":"brief analysis"},{"name":"Artistic","score":80,"description":"brief analysis"}]}]}

RULES:
- Return ONLY the JSON object, no markdown
- Do NOT include any double quotes (") inside description text; if needed, use single quotes
- Keep descriptions SHORT (under 50 words each)
- Each source MUST have exactly 6 categories
- Scores are 0-100 integers
- Use the EXACT source names provided`;

        const userPrompt = `Analyze these ${batch.length} audio source${batch.length > 1 ? 's' : ''}:

${sourcesList}

Return JSON with "sources" array. Each source needs: name (exact match), categories array with Emotional, Cognitive, Social, Communication, Contextual, Artistic (each with name, score 0-100, short description).

Keep descriptions brief. Scores should differ between sources to show unique identities.`;

        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.2,
            max_tokens: 4000, // Ensure we get complete responses
          }),
        });

        if (!response.ok) {
          if (response.status === 429) {
            return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
              status: 429,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          if (response.status === 402) {
            return new Response(JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }), {
              status: 402,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          const errorText = await response.text();
          console.error('AI gateway error:', response.status, errorText);
          return new Response(JSON.stringify({ error: `AI gateway error: ${response.statusText}` }), {
            status: response.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const data = await response.json();
        const analysisText = data.choices[0].message.content;
        
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
      if (supabaseAdmin && freshResults.length > 0) {
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

      // Build batch insert data
      const insertData = allResults.map(sourceResult => {
        const categories = sourceResult.categories.reduce((acc, cat) => {
          const key = cat.name.toLowerCase();
          acc[`${key}_score`] = cat.score;
          acc[`${key}_desc`] = cat.description;
          return acc;
        }, {} as Record<string, any>);

        return {
          user_id,
          audio_source_id: sourceIdMap.get(sourceResult.name) || null,
          source_name: sourceResult.name,
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

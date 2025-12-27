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
  audio_source_id?: string; // Optional: link to audio_sources table
}

interface AnalysisRequest {
  sources: AudioSource[];
  user_id?: string; // Optional: if provided, save results and update fingerprint
  save_results?: boolean; // Whether to persist the analysis
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

    // Create semantic analysis prompt based on SemanticAC framework
    const sourcesList = sources.map(s => `- ${s.name}`).join('\n');
    
    const systemPrompt = `You are an expert audio semantic analyzer implementing the SemanticAC framework.

CRITICAL OUTPUT FORMAT - YOU MUST FOLLOW THIS EXACTLY:
{
  "sources": [
    {
      "name": "EXACT SOURCE NAME HERE",
      "categories": [
        {"name": "Emotional", "score": 0-100, "description": "analysis"},
        {"name": "Cognitive", "score": 0-100, "description": "analysis"},
        {"name": "Social", "score": 0-100, "description": "analysis"},
        {"name": "Communication", "score": 0-100, "description": "analysis"},
        {"name": "Contextual", "score": 0-100, "description": "analysis"},
        {"name": "Artistic", "score": 0-100, "description": "analysis"}
      ]
    }
  ]
}

DO NOT group by categories. DO NOT use "confidence" - use "score". DO NOT include top-level categories array.

ANALYSIS REQUIREMENTS:

1. COMPARATIVE ANALYSIS: Explicitly differentiate between sources. Each source has a unique sonic identity - reveal these differences through distinct scoring patterns.

2. RELATIVE SCORING: Scores (0-100) reflect how CENTRAL each category is to that specific source's sonic identity. High score = defining characteristic.

3. DIFFERENTIATION MANDATE: Scores MUST vary meaningfully between sources. Use the full 0-100 range to show real differences.

SCORING GUIDELINES:
- Each source MUST have exactly 6 categories: Emotional, Cognitive, Social, Communication, Contextual, Artistic
- Scores represent category centrality to source identity, not just presence
- Compare sources directly - if one is more emotional than another, scores must reflect this
- Use the full 0-100 range - scores in the 40s, 50s, 60s are valid and useful
- Identical scores across sources require strong justification`;

    const userPrompt = `Analyze these ${sources.length} audio source${sources.length > 1 ? 's' : ''} using the SemanticAC semantic ontology framework:

${sourcesList}

CRITICAL: Return ONLY a JSON object with "sources" array. DO NOT group by categories.

For EACH source listed above, provide:
1. "name" field - EXACT source name from the list above (including artist name after the dash)
2. "categories" array with ALL 6 categories in this exact order: Emotional, Cognitive, Social, Communication, Contextual, Artistic
3. Each category MUST have: "name", "score" (integer 0-100), and "description" (comparative analysis)

Use the full 0-100 range. Scores MUST differ between sources to show their unique ontological fingerprints.

Consider for each source:
- Temporal-spectral patterns and harmonic complexity
- Semantic label alignment and genre characteristics  
- Comparative semantic positioning - how does THIS source differ from the others?
- How central is each category to THIS source's unique identity?`;

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
    
    console.log('Raw AI response:', analysisText);

    // Parse JSON response
    let analysisResult: { sources: SourceResult[] };
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = analysisText.match(/```json\s*([\s\S]*?)\s*```/) || 
                       analysisText.match(/```\s*([\s\S]*?)\s*```/) ||
                       [null, analysisText];
      const jsonText = jsonMatch[1] || analysisText;
      analysisResult = JSON.parse(jsonText.trim());
      
      // Validate the response has the correct structure
      if (!analysisResult.sources || !Array.isArray(analysisResult.sources)) {
        console.error('Invalid response structure - missing sources array. Attempting repair...');
        console.error('Received structure:', JSON.stringify(analysisResult, null, 2));
        
        // Try to repair by converting category-centric to source-centric
        if ((analysisResult as any).categories && Array.isArray((analysisResult as any).categories)) {
          console.log('Attempting to convert category-centric format to source-centric format...');
          
          // Build a map of all unique source names from the categories
          const sourceNamesSet = new Set<string>();
          (analysisResult as any).categories.forEach((category: any) => {
            if (category.sources && Array.isArray(category.sources)) {
              category.sources.forEach((sourceName: string) => sourceNamesSet.add(sourceName));
            }
          });
          
          // Create source objects
          const sourceMap = new Map<string, any>();
          Array.from(sourceNamesSet).forEach(sourceName => {
            sourceMap.set(sourceName, {
              name: sourceName,
              categories: []
            });
          });
          
          // Populate categories for each source
          (analysisResult as any).categories.forEach((category: any) => {
            const categoryName = category.name;
            const score = category.confidence || category.score || 50;
            const description = category.description || '';
            
            if (category.sources && Array.isArray(category.sources)) {
              category.sources.forEach((sourceName: string) => {
                const source = sourceMap.get(sourceName);
                if (source) {
                  source.categories.push({
                    name: categoryName,
                    score: score,
                    description: description
                  });
                }
              });
            }
          });
          
          analysisResult = { sources: Array.from(sourceMap.values()) };
          console.log('Repair successful. Converted structure:', JSON.stringify(analysisResult, null, 2));
        } else {
          return new Response(JSON.stringify({ 
            error: 'AI returned invalid format. Expected { sources: [...] } with 6 categories per source. Please try again.' 
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      
      // Validate each source has categories and clean up names
      for (const source of analysisResult.sources) {
        // Remove any "(track)" or "(file)" suffix that the AI might have added
        source.name = source.name.replace(/\s*\((track|file)\)\s*$/i, '').trim();
        
        if (!source.categories || !Array.isArray(source.categories) || source.categories.length !== 6) {
          console.error('Invalid source structure:', source);
          return new Response(JSON.stringify({ 
            error: `Source "${source.name}" has ${source.categories?.length || 0} categories instead of required 6. Please try again.` 
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.error('Raw response was:', analysisText);
      return new Response(JSON.stringify({ 
        error: 'Failed to parse AI response as JSON. The model may have returned invalid JSON. Please try again.' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Analysis complete:', analysisResult);

    // If user_id is provided and save_results is true, persist the analysis
    let fingerprint = null;
    if (user_id && save_results && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      console.log('Saving analysis results for user:', user_id);
      
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Create a map of source names to their audio_source_ids
      const sourceIdMap = new Map<string, string | undefined>();
      sources.forEach(s => {
        sourceIdMap.set(s.name, s.audio_source_id);
      });

      // Insert each source analysis
      for (const sourceResult of analysisResult.sources) {
        const categories = sourceResult.categories.reduce((acc, cat) => {
          const key = cat.name.toLowerCase();
          acc[`${key}_score`] = cat.score;
          acc[`${key}_desc`] = cat.description;
          return acc;
        }, {} as Record<string, any>);

        const { error: insertError } = await supabaseAdmin
          .from('source_analyses')
          .insert({
            user_id,
            audio_source_id: sourceIdMap.get(sourceResult.name) || null,
            source_name: sourceResult.name,
            ...categories,
          });

        if (insertError) {
          console.error('Error inserting source analysis:', insertError);
        }
      }

      // Recalculate user fingerprint using the database function
      const { error: rpcError } = await supabaseAdmin
        .rpc('recalculate_user_fingerprint', { p_user_id: user_id });

      if (rpcError) {
        console.error('Error recalculating fingerprint:', rpcError);
      } else {
        // Fetch the updated fingerprint
        const { data: fpData } = await supabaseAdmin
          .from('user_fingerprints')
          .select('*')
          .eq('user_id', user_id)
          .single();

        fingerprint = fpData;
        console.log('Updated fingerprint:', fingerprint);
      }
    }

    return new Response(JSON.stringify({ 
      sources: analysisResult.sources,
      fingerprint,
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

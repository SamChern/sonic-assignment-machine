const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

interface AudioSource {
  name: string;
  type: 'file' | 'track';
}

interface AnalysisRequest {
  sources: AudioSource[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sources }: AnalysisRequest = await req.json();

    if (!sources || sources.length === 0) {
      throw new Error('No audio sources provided');
    }

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log(`Analyzing ${sources.length} audio source(s):`, sources);

    // Create semantic analysis prompt based on SemanticAC framework
    const sourcesList = sources.map(s => `- ${s.name} (${s.type})`).join('\n');
    
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
    let analysisResult;
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
        if (analysisResult.categories && Array.isArray(analysisResult.categories)) {
          console.log('Attempting to convert category-centric format to source-centric format...');
          
          // Build a map of all unique source names from the categories
          const sourceNamesSet = new Set<string>();
          analysisResult.categories.forEach((category: any) => {
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
          analysisResult.categories.forEach((category: any) => {
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
      
      // Validate each source has categories
      for (const source of analysisResult.sources) {
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

    return new Response(JSON.stringify(analysisResult), {
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

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

Return ONLY valid JSON matching { sources: [...] } with 6 categories per source. Do not include top-level categories. Do not append (track) or extra descriptors to names. No markdown.

CRITICAL REQUIREMENTS:

1. COMPARATIVE ANALYSIS: You must explicitly differentiate between sources. Each source has a unique sonic identity - your analysis must reveal these differences through distinct scoring patterns.

2. RELATIVE SCORING: Scores (0-100) must reflect how CENTRAL each category is to that specific source's sonic identity. A high Emotional score means emotion is a defining characteristic of that source, not just that emotion is present.

3. DIFFERENTIATION MANDATE: Scores MUST vary meaningfully between sources unless they genuinely share identical characteristics in a category. Avoid giving similar scores across sources - use the full 0-100 range to show real differences.

Example correct output structure:
{
  "sources": [
    {
      "name": "Miles Davis - So What",
      "categories": [
        {"name": "Emotional", "score": 65, "description": "Modal jazz restraint with subdued emotional expression"},
        {"name": "Cognitive", "score": 85, "description": "Complex harmonic improvisation requiring deep listening"},
        {"name": "Social", "score": 88, "description": "Legendary ensemble collaboration and musical dialogue"},
        {"name": "Communication", "score": 78, "description": "Abstract instrumental conversation between musicians"},
        {"name": "Contextual", "score": 95, "description": "Defining moment in modal jazz history from Kind of Blue"},
        {"name": "Artistic", "score": 98, "description": "Revolutionary modal approach and improvisational mastery"}
      ]
    },
    {
      "name": "Taylor Swift - Anti-Hero",
      "categories": [
        {"name": "Emotional", "score": 92, "description": "Highly confessional lyrics with raw emotional vulnerability"},
        {"name": "Cognitive", "score": 72, "description": "Narrative storytelling with metaphorical self-reflection"},
        {"name": "Social", "score": 85, "description": "Resonates with shared experiences of self-doubt and anxiety"},
        {"name": "Communication", "score": 96, "description": "Direct lyrical communication of internal narrative"},
        {"name": "Contextual", "score": 80, "description": "Contemporary pop-indie crossover with personal storytelling"},
        {"name": "Artistic", "score": 88, "description": "Strong songwriting craft with minimalist production choices"}
      ]
    }
  ]
}

SCORING GUIDELINES:
- Each source MUST have exactly 6 categories: Emotional, Cognitive, Social, Communication, Contextual, Artistic
- Scores represent category centrality to source identity, not just presence
- Compare sources directly - if one is more emotional than another, scores must reflect this
- Use the full 0-100 range - scores in the 40s, 50s, 60s are valid and useful
- Identical scores across sources require strong justification`;

    const userPrompt = `Analyze these audio sources using SemanticAC semantic ontology framework:

${sourcesList}

For each source, provide a score (0-100) for each category that reflects how CENTRAL that category is to the source's identity. Use the full 0-100 range. If two sources differ in emotional intensity, their scores MUST reflect that difference.

Return a JSON object with a "sources" array. Each source MUST have:
1. "name" field matching the exact source name above
2. "categories" array with ALL 6 categories: Emotional, Cognitive, Social, Communication, Contextual, Artistic
3. Each category MUST have: "name", "score" (0-100), and "description"

Consider for each source:
- Temporal-spectral patterns and harmonic complexity
- Semantic label alignment and genre characteristics
- Comparative semantic positioning across all sources
- How each category contributes to that source's unique identity`;

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
          
          // Reconstruct as per-source structure
          const sourceMap = new Map<string, any>();
          
          analysisResult.categories.forEach((category: any) => {
            if (category.sources && Array.isArray(category.sources)) {
              category.sources.forEach((sourceName: string) => {
                if (!sourceMap.has(sourceName)) {
                  sourceMap.set(sourceName, {
                    name: sourceName,
                    categories: []
                  });
                }
                sourceMap.get(sourceName).categories.push({
                  name: category.name,
                  score: category.confidence || 50,
                  description: category.description || ''
                });
              });
            }
          });
          
          analysisResult = { sources: Array.from(sourceMap.values()) };
          console.log('Repair successful. New structure:', JSON.stringify(analysisResult, null, 2));
        } else {
          return new Response(JSON.stringify({ 
            error: 'AI returned invalid format - expected { sources: [...] } with 6 categories per source. Received a different structure. Please try again.' 
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

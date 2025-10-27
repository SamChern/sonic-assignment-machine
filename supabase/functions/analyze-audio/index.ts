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

CRITICAL: You MUST return per-source scoring. Each source gets its OWN individual scores for ALL 6 categories.

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

SCORING RULES:
- Each source MUST have exactly 6 categories with individual scores
- Scores MUST be comparative: different sources should have meaningfully different scores
- Use full 0-100 range to show differences between sources
- Score represents how CENTRAL that category is to that specific source's sonic identity
- Be discriminating - avoid clustering scores together`;

    const userPrompt = `Analyze these audio sources using SemanticAC semantic ontology framework:

${sourcesList}

Return a JSON object with a "sources" array. Each source MUST have:
1. "name" field matching the exact source name above
2. "categories" array with ALL 6 categories: Emotional, Cognitive, Social, Communication, Contextual, Artistic
3. Each category MUST have: "name", "score" (0-100), and "description"

Be DISCRIMINATING with scores - use the full range to differentiate sources meaningfully.`;

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
        temperature: 0.7,
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
      throw new Error(`AI gateway error: ${response.statusText}`);
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
        console.error('Invalid response structure - missing sources array:', analysisResult);
        throw new Error('AI returned invalid format - expected sources array');
      }
      
      // Validate each source has categories
      for (const source of analysisResult.sources) {
        if (!source.categories || !Array.isArray(source.categories) || source.categories.length !== 6) {
          console.error('Invalid source structure:', source);
          throw new Error(`Source "${source.name}" missing proper categories array`);
        }
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.error('Raw response was:', analysisText);
      throw new Error('Failed to parse analysis results: ' + (parseError instanceof Error ? parseError.message : 'Unknown error'));
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

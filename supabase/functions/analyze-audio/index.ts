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
Your role is to analyze audio sources using:
- Semantic label extraction and text encoding
- Audio-text modality alignment via transformer-based encoders
- Hierarchical feature extraction from mel-spectrograms
- Contrastive learning for semantic consistency
- Cosine similarity in shared embedding space

Map your analysis to exactly 6 ontological categories: Emotional, Cognitive, Social, Communication, Contextual, and Artistic.

CRITICAL SCORING REQUIREMENTS:
- Each source receives its own individual score (0-100) for EACH of the 6 categories
- Scores MUST be comparative and relative across sources
- Scores represent how CENTRAL that category is to each source's sonic identity
- Use the FULL 0-100 range to differentiate sources
- If two sources differ in a category, their scores MUST reflect that difference
- Do NOT give similar scores unless sources genuinely share the same characteristics

Respond ONLY with valid JSON in this exact format:
{
  "sources": [
    {
      "name": "<exact source name from input>",
      "categories": [
        {
          "name": "Emotional",
          "score": <number 0-100>,
          "description": "<specific analysis for this source>"
        },
        {
          "name": "Cognitive",
          "score": <number 0-100>,
          "description": "<specific analysis for this source>"
        },
        {
          "name": "Social",
          "score": <number 0-100>,
          "description": "<specific analysis for this source>"
        },
        {
          "name": "Communication",
          "score": <number 0-100>,
          "description": "<specific analysis for this source>"
        },
        {
          "name": "Contextual",
          "score": <number 0-100>,
          "description": "<specific analysis for this source>"
        },
        {
          "name": "Artistic",
          "score": <number 0-100>,
          "description": "<specific analysis for this source>"
        }
      ]
    }
  ]
}`;

    const userPrompt = `Analyze these audio sources using SemanticAC semantic ontology framework:

${sourcesList}

Perform PER-SOURCE comparative semantic analysis for EACH of the 6 categories: Emotional, Cognitive, Social, Communication, Contextual, and Artistic.

SCORING INSTRUCTIONS:
- Assign a score (0-100) to EACH source for EACH category
- Scores must reflect how CENTRAL that category is to that specific source's identity
- Be DISCRIMINATING: Use the full range. Don't cluster scores together.
- Compare sources to differentiate them meaningfully
- Example: A Miles Davis modal jazz piece should score differently from a Taylor Swift pop song in Emotional intensity

Consider for each source:
- Temporal-spectral patterns in mel-spectrograms
- Semantic label alignment and text embeddings
- Genre-specific ontological characteristics
- Hierarchical transformer feature extraction
- Comparative semantic positioning across sources
- Environmental sound classification patterns`;

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
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      throw new Error('Failed to parse analysis results');
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPOTIFY_CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID')?.trim();
const SPOTIFY_CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET')?.trim();

console.log('Spotify credentials check:', {
  hasClientId: !!SPOTIFY_CLIENT_ID,
  hasClientSecret: !!SPOTIFY_CLIENT_SECRET,
  clientIdLength: SPOTIFY_CLIENT_ID?.length,
  clientSecretLength: SPOTIFY_CLIENT_SECRET?.length
});

async function getSpotifyToken(): Promise<string> {
  console.log('Getting Spotify access token...');
  
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Spotify token error:', error);
    throw new Error(`Failed to get Spotify token: ${response.statusText}`);
  }

  const data = await response.json();
  console.log('Successfully obtained Spotify token');
  return data.access_token;
}

async function searchSpotify(query: string, type: string, token: string) {
  console.log(`Searching Spotify for: ${query} (type: ${type})`);
  
  const params = new URLSearchParams({
    q: query,
    type: type,
    limit: '10',
  });

  const response = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Spotify search error:', error);
    throw new Error(`Spotify search failed: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`Found ${data.tracks?.items?.length || 0} tracks`);
  return data;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, type = 'track' } = await req.json();

    if (!query) {
      throw new Error('Query parameter is required');
    }

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      throw new Error('Spotify credentials not configured');
    }

    const token = await getSpotifyToken();
    const results = await searchSpotify(query, type, token);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in spotify-search function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

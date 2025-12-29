import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // TEMPORARY: Returns the LOVABLE_API_KEY value
  // DELETE THIS FUNCTION AFTER COPYING THE KEY
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  
  return new Response(
    JSON.stringify({ 
      key: apiKey,
      warning: "DELETE this function after copying the key!" 
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});

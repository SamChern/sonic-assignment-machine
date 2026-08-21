// Maintenance helper: proxies a narrow set of read/diagnostic calls to the EC2
// analysis API using a server-held API key.
//
// Authorization: admin role (public.user_roles) or an internal service-role
// invocation. Never callable by anonymous or non-admin signed-in users — the
// upstream API key would otherwise be usable by anyone.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Only these upstream paths may be reached through the proxy.
const ALLOWED_ENDPOINTS = new Set([
  '/health',
  '/status',
  '/metrics',
  '/analyze',
  '/analyze_full',
]);
const ALLOWED_METHODS = new Set(['GET', 'POST']);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ error: authz.message }, authz.status);
    }

    const awsApiUrl = Deno.env.get('AWS_API_URL');
    const awsApiKey = Deno.env.get('AWS_API_KEY');
    if (!awsApiUrl || !awsApiKey) {
      console.error('Missing AWS_API_URL or AWS_API_KEY environment variables');
      return json({ error: 'Server configuration error' }, 500);
    }

    const parsed = await req.json().catch(() => null);
    if (!parsed || typeof parsed !== 'object') {
      return json({ error: 'Body must be JSON' }, 400);
    }
    const endpoint = typeof parsed.endpoint === 'string' ? parsed.endpoint : '';
    const method = typeof parsed.method === 'string' ? parsed.method.toUpperCase() : 'GET';
    const body = parsed.body;

    if (!endpoint) return json({ error: 'Missing endpoint parameter' }, 400);
    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      return json({ error: `Endpoint not allowed: ${endpoint}` }, 400);
    }
    if (!ALLOWED_METHODS.has(method)) {
      return json({ error: `Method not allowed: ${method}` }, 400);
    }

    const targetUrl = `${awsApiUrl}${endpoint}`;
    console.log(
      `aws-proxy ${method} ${endpoint} by ${authz.isInternal ? 'internal' : authz.userId}`,
    );

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': awsApiKey,
      },
    };
    if (body !== undefined && method === 'POST') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const responseData = await response.json().catch(() => ({}));
    console.log(`aws-proxy upstream status: ${response.status}`);

    return json(responseData, response.status);
  } catch (error: unknown) {
    console.error('Proxy error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Proxy request failed';
    return json({ error: errorMessage }, 500);
  }
});

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { EC2_ENDPOINTS } from '@/config/ec2';

interface EC2ApiResponse<T = unknown> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface EC2ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: Record<string, unknown>;
}

export const useEC2Api = () => {
  const [loading, setLoading] = useState(false);

  const callEC2Api = useCallback(async <T = unknown>(
    endpoint: string,
    options: EC2ApiOptions = {}
  ): Promise<EC2ApiResponse<T>> => {
    const { method = 'GET', body } = options;
    
    setLoading(true);
    
    try {
      console.log(`Calling EC2 API via proxy: ${method} ${endpoint}`);
      
      const { data, error } = await supabase.functions.invoke('aws-proxy', {
        body: {
          endpoint,
          method,
          body: body || null,
        },
      });

      if (error) {
        console.error('AWS proxy error:', error);
        return { 
          data: null, 
          error: error.message || 'Failed to call AWS proxy', 
          loading: false 
        };
      }

      return { data: data as T, error: null, loading: false };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('EC2 API call failed:', errorMessage);
      return { data: null, error: errorMessage, loading: false };
    } finally {
      setLoading(false);
    }
  }, []);

  // Convenience methods
  const get = useCallback(<T = unknown>(endpoint: string) => 
    callEC2Api<T>(endpoint, { method: 'GET' }), [callEC2Api]);

  const post = useCallback(<T = unknown>(endpoint: string, body: Record<string, unknown>) => 
    callEC2Api<T>(endpoint, { method: 'POST', body }), [callEC2Api]);

  const put = useCallback(<T = unknown>(endpoint: string, body: Record<string, unknown>) => 
    callEC2Api<T>(endpoint, { method: 'PUT', body }), [callEC2Api]);

  const del = useCallback(<T = unknown>(endpoint: string) => 
    callEC2Api<T>(endpoint, { method: 'DELETE' }), [callEC2Api]);

  // Health check helper
  const checkHealth = useCallback(async () => {
    const result = await get<{ status: string; timestamp: string }>(EC2_ENDPOINTS.health);
    return result;
  }, [get]);

  return {
    loading,
    callEC2Api,
    get,
    post,
    put,
    del,
    checkHealth
  };
};

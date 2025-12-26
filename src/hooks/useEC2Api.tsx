import { useState, useCallback } from 'react';
import { getEC2Url, EC2_CONFIG } from '@/config/ec2';

interface EC2ApiResponse<T = unknown> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface EC2ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: Record<string, unknown>;
  timeout?: number;
}

export const useEC2Api = () => {
  const [loading, setLoading] = useState(false);

  const callEC2Api = useCallback(async <T = unknown>(
    endpoint: string,
    options: EC2ApiOptions = {}
  ): Promise<EC2ApiResponse<T>> => {
    const { method = 'GET', body, timeout = EC2_CONFIG.timeout } = options;
    
    setLoading(true);
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const url = getEC2Url(endpoint);
      const isHealthCheck = endpoint.includes('/health');
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // Add API key for protected endpoints (not health check)
      if (!isHealthCheck) {
        headers['x-api-key'] = EC2_CONFIG.apiKey;
      }
      
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (body && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('EC2 API error:', response.status, errorText);
        return { 
          data: null, 
          error: `HTTP ${response.status}: ${errorText || response.statusText}`, 
          loading: false 
        };
      }

      const data = await response.json();
      return { data: data as T, error: null, loading: false };
    } catch (err) {
      let errorMessage = 'Unknown error';
      
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          errorMessage = 'Request timed out';
        } else if (err.message.includes('Failed to fetch')) {
          errorMessage = 'Cannot connect to EC2 - check if port 80 is open in AWS Security Group';
        } else {
          errorMessage = err.message;
        }
      }
      
      console.error('EC2 API call failed:', errorMessage);
      return { data: null, error: errorMessage, loading: false };
    } finally {
      clearTimeout(timeoutId);
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
    const result = await get<{ status: string; timestamp: string }>('/api/health');
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

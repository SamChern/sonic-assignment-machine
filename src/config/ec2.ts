// EC2 API Configuration
// Update this URL when your EC2 instance changes

export const EC2_CONFIG = {
  // Direct EC2 URL - requires port 80 open in AWS Security Group
  baseUrl: 'http://35.94.20.4',
  
  // API key for protected endpoints (health check is public)
  apiKey: 'e09560a0434689a297c06ed3418ad55e7a56802b6957b28cae53cf48254c2911',
  
  // API endpoints
  endpoints: {
    health: '/api/health',
    analyze: '/api/analyze-audio',
    network: '/api/calculate-network',
  },
  
  // Request timeout in milliseconds
  timeout: 30000,
};

// Helper to build full URL
export const getEC2Url = (endpoint: string): string => {
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${EC2_CONFIG.baseUrl}${path}`;
};

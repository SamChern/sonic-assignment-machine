// EC2 API Endpoints
// All calls are routed through the aws-proxy edge function for security

export const EC2_ENDPOINTS = {
  health: '/api/health',
  analyze: '/api/analyze-audio',
  network: '/api/calculate-network',
};

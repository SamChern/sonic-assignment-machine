-- Admin-only credentials storage for third-party API integrations
CREATE TABLE public.integration_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id text NOT NULL,
  field_key text NOT NULL,
  field_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (integration_id, field_key)
);

ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;

-- Only admins can read/write credentials. Service role bypasses RLS for edge functions.
CREATE POLICY "Admins can view credentials metadata"
  ON public.integration_credentials FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert credentials"
  ON public.integration_credentials FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update credentials"
  ON public.integration_credentials FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete credentials"
  ON public.integration_credentials FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER set_integration_credentials_updated_at
  BEFORE UPDATE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Test history for auditing connection tests
CREATE TABLE public.integration_test_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id text NOT NULL,
  tested_by uuid,
  success boolean NOT NULL,
  latency_ms integer,
  error_message text,
  response_sample jsonb,
  tested_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_test_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view test history"
  ON public.integration_test_history FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert test history"
  ON public.integration_test_history FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_integration_test_history_integration_time
  ON public.integration_test_history (integration_id, tested_at DESC);
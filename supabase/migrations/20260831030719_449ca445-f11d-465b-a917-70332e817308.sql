CREATE TABLE public.market_baselines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market text NOT NULL,
  market_label text NOT NULL,
  metric text NOT NULL,
  mean numeric NOT NULL,
  stddev numeric NOT NULL CHECK (stddev > 0),
  sample_size integer NOT NULL DEFAULT 0,
  unit text,
  source_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (market, metric)
);

GRANT SELECT ON public.market_baselines TO anon;
GRANT SELECT ON public.market_baselines TO authenticated;
GRANT ALL ON public.market_baselines TO service_role;

ALTER TABLE public.market_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Market baselines are readable by everyone"
  ON public.market_baselines FOR SELECT USING (true);

CREATE POLICY "Admins manage market baselines"
  ON public.market_baselines FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER market_baselines_updated_at
  BEFORE UPDATE ON public.market_baselines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.market_baselines (market, market_label, metric, mean, stddev, sample_size, unit, source_note) VALUES
  ('commercial_release','Commercial releases (streaming)','tempo_bpm',120.9,29.5,170000,'BPM','Published Spotify audio-feature corpus of ~170k commercially released tracks'),
  ('commercial_release','Commercial releases (streaming)','loudness_db',-8.2,4.0,170000,'dBFS','Published Spotify audio-feature corpus of ~170k commercially released tracks'),
  ('commercial_release','Commercial releases (streaming)','pitch',62,17,170000,'0-100','Reference tonal-clarity centre for released music, calibrated to SonicSIM pitch scale'),
  ('commercial_release','Commercial releases (streaming)','rhythm',66,16,170000,'0-100','Reference beat-regularity centre for released music, calibrated to SonicSIM rhythm scale'),
  ('commercial_release','Commercial releases (streaming)','timbre',58,15,170000,'0-100','Reference spectral-richness centre for released music, calibrated to SonicSIM timbre scale');

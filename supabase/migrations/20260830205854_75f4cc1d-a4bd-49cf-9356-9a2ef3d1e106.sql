-- Twelve archetype centroids for the SONICSIM Ensemble
CREATE TABLE public.sonic_archetypes (
  slug text PRIMARY KEY,
  name text NOT NULL,
  meaning text NOT NULL,
  dominant_axes text[] NOT NULL,
  centroid jsonb NOT NULL,
  anchors text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sonic_archetypes TO authenticated;
GRANT ALL ON public.sonic_archetypes TO service_role;

ALTER TABLE public.sonic_archetypes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Archetypes are readable by signed-in users"
  ON public.sonic_archetypes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage archetypes"
  ON public.sonic_archetypes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Deterministic signature cache, keyed by subject hash
CREATE TABLE public.sonic_signatures (
  subject_hash text PRIMARY KEY,
  subject_ref text,
  vector jsonb NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  audio_path text,
  audio_bytes integer,
  archetype_slug text REFERENCES public.sonic_archetypes(slug),
  distance numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sonic_signatures_archetype ON public.sonic_signatures(archetype_slug);

GRANT SELECT ON public.sonic_signatures TO authenticated;
GRANT ALL ON public.sonic_signatures TO service_role;

ALTER TABLE public.sonic_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signatures are readable by signed-in users"
  ON public.sonic_signatures FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_sonic_archetypes_updated_at
  BEFORE UPDATE ON public.sonic_archetypes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_sonic_signatures_updated_at
  BEFORE UPDATE ON public.sonic_signatures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed the Ensemble: dominant pair at 75/70, remaining axes 45-55
INSERT INTO public.sonic_archetypes (slug, name, meaning, dominant_axes, centroid, anchors, sort_order) VALUES
('torchbearer','The Torchbearer','feels aloud, moves rooms','{emotional,communication}',
 '{"emotional":75,"cognitive":48,"social":52,"communication":70,"contextual":50,"artistic":52}','{"Nina Simone","Maria Callas"}',1),
('architect','The Architect','pattern as beauty','{cognitive,artistic}',
 '{"emotional":48,"cognitive":75,"social":45,"communication":50,"contextual":52,"artistic":70}','{"J.S. Bach","M.C. Escher"}',2),
('gatherer','The Gatherer','belongs everywhere at once','{social,contextual}',
 '{"emotional":52,"cognitive":48,"social":75,"communication":55,"contextual":70,"artistic":50}','{"Ella Fitzgerald","Pieter Bruegel"}',3),
('cartographer','The Cartographer','reads the room, then the map','{contextual,cognitive}',
 '{"emotional":50,"cognitive":70,"social":48,"communication":45,"contextual":75,"artistic":55}','{"Claude Debussy","Hokusai"}',4),
('flame','The Flame','intensity as craft','{emotional,artistic}',
 '{"emotional":75,"cognitive":50,"social":45,"communication":52,"contextual":48,"artistic":70}','{"Vincent van Gogh","Jimi Hendrix"}',5),
('herald','The Herald','the signal that organizes','{communication,social}',
 '{"emotional":55,"cognitive":48,"social":70,"communication":75,"contextual":50,"artistic":45}','{"Louis Armstrong","Keith Haring"}',6),
('contemplative','The Contemplative','quiet depth, long attention','{cognitive,contextual}',
 '{"emotional":45,"cognitive":75,"social":45,"communication":48,"contextual":70,"artistic":52}','{"Erik Satie","Agnes Martin"}',7),
('weaver','The Weaver','makes community into form','{social,artistic}',
 '{"emotional":52,"cognitive":50,"social":75,"communication":55,"contextual":48,"artistic":70}','{"Martha Graham","Faith Ringgold"}',8),
('pilgrim','The Pilgrim','place-moved, season-tuned','{contextual,emotional}',
 '{"emotional":70,"cognitive":48,"social":45,"communication":50,"contextual":75,"artistic":55}','{"John Coltrane","Caspar David Friedrich"}',9),
('prism','The Prism','translates feeling across mediums','{artistic,communication}',
 '{"emotional":55,"cognitive":50,"social":48,"communication":70,"contextual":45,"artistic":75}','{"Wassily Kandinsky","Josephine Baker"}',10),
('anchor','The Anchor','steadies the collective','{social,cognitive}',
 '{"emotional":48,"cognitive":70,"social":75,"communication":52,"contextual":50,"artistic":45}','{"Duke Ellington","Charles & Ray Eames"}',11),
('undertow','The Undertow','still surface, deep current','{emotional,cognitive}',
 '{"emotional":75,"cognitive":70,"social":45,"communication":48,"contextual":52,"artistic":50}','{"Frédéric Chopin","Edward Hopper"}',12);
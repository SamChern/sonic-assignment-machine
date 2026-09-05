-- Grants for the nine Batch E tables (the Data API has no default privileges on public).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resonance_definitions TO authenticated;
GRANT ALL ON public.resonance_definitions TO service_role;
GRANT SELECT ON public.resonance_definitions TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_digests TO authenticated;
GRANT ALL ON public.learning_digests TO service_role;
GRANT SELECT ON public.learning_digests TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commons_pool_items TO authenticated;
GRANT ALL ON public.commons_pool_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commons_license_ledger TO authenticated;
GRANT ALL ON public.commons_license_ledger TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commons_payouts TO authenticated;
GRANT ALL ON public.commons_payouts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hear_api_keys TO authenticated;
GRANT ALL ON public.hear_api_keys TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.frame_embeddings TO authenticated;
GRANT ALL ON public.frame_embeddings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_contexts TO authenticated;
GRANT ALL ON public.venue_contexts TO service_role;
GRANT SELECT ON public.sonic_passports TO authenticated;
GRANT ALL ON public.sonic_passports TO service_role;

-- Public method page: anyone may read the active weight set and published notes only.
CREATE POLICY "Anyone can read the active resonance definition"
ON public.resonance_definitions FOR SELECT TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Anyone can read published learning notes"
ON public.learning_digests FOR SELECT TO anon, authenticated
USING (published = true);

-- A person may read their own passports (issuing/revoking stays in the function).
CREATE POLICY "Users can read their own passports"
ON public.sonic_passports FOR SELECT TO authenticated
USING (user_id = auth.uid());
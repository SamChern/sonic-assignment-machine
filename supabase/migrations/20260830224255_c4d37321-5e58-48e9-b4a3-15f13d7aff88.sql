CREATE INDEX IF NOT EXISTS idx_score_queue_updated_at ON public.intuizi_score_queue (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_score_queue_broken_updated ON public.intuizi_score_queue (updated_at DESC) WHERE status IN ('failed','dead_letter');
CREATE INDEX IF NOT EXISTS idx_score_queue_activation_updated ON public.intuizi_score_queue (activation_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_score_queue_object_updated ON public.intuizi_score_queue (object_key, updated_at DESC);
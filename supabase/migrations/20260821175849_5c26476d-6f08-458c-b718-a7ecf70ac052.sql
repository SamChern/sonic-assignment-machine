DELETE FROM public.librosa_call_log WHERE cache_key = 'test-kick-key';
DELETE FROM public.analysis_jobs WHERE cache_key = 'test-kick-key';
DELETE FROM public.librosa_cache WHERE cache_key = 'test-kick-key';
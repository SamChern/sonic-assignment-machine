-- Admin people directory: one bounded, admin-only read that joins the
-- account, its roles, its membership and any creator application.
CREATE OR REPLACE FUNCTION public.admin_list_people(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  email text,
  username text,
  persona text,
  signed_up_at timestamptz,
  last_sign_in_at timestamptz,
  roles text[],
  membership_plan text,
  membership_status text,
  billing_period text,
  price_cents integer,
  creator_status text,
  analyses_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    p.username,
    p.persona,
    u.created_at,
    u.last_sign_in_at,
    COALESCE(r.roles, ARRAY[]::text[]),
    s.plan,
    s.status,
    s.billing_period,
    s.price_cents,
    c.status,
    COALESCE(a.n, 0)::integer
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT array_agg(ur.role::text ORDER BY ur.role::text) AS roles
    FROM public.user_roles ur WHERE ur.user_id = u.id
  ) r ON true
  LEFT JOIN public.listener_subscriptions s ON s.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT aa.status
    FROM public.access_applications aa
    WHERE aa.submitted_by = u.id AND aa.kind = 'creator'
    ORDER BY aa.created_at DESC
    LIMIT 1
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM public.source_analyses sa WHERE sa.user_id = u.id
  ) a ON true
  WHERE v_search IS NULL
     OR u.email ILIKE '%' || v_search || '%'
     OR COALESCE(p.username, '') ILIKE '%' || v_search || '%'
  ORDER BY u.created_at DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_people(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_people(text, integer, integer) TO authenticated;

-- Admin membership control: set a person's plan/status without handing out
-- write access to the membership table itself.
CREATE OR REPLACE FUNCTION public.admin_set_membership(
  p_user_id uuid,
  p_plan text DEFAULT 'listener',
  p_status text DEFAULT 'active',
  p_billing_period text DEFAULT 'monthly'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_price integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_status NOT IN ('awaiting_payment', 'active', 'cancelled') THEN
    RAISE EXCEPTION 'Unknown status %', p_status;
  END IF;
  IF p_billing_period NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION 'Unknown billing period %', p_billing_period;
  END IF;

  SELECT email::text INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'No such account';
  END IF;

  v_price := CASE WHEN p_billing_period = 'annual' THEN 2999 ELSE 299 END;

  INSERT INTO public.listener_subscriptions
    (user_id, email, plan, status, billing_period, price_cents, terms_accepted,
     activated_at, cancelled_at)
  VALUES
    (p_user_id, v_email, p_plan, p_status, p_billing_period, v_price, true,
     CASE WHEN p_status = 'active' THEN now() ELSE NULL END,
     CASE WHEN p_status = 'cancelled' THEN now() ELSE NULL END)
  ON CONFLICT (user_id) DO UPDATE
  SET plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      billing_period = EXCLUDED.billing_period,
      price_cents = EXCLUDED.price_cents,
      activated_at = CASE
        WHEN EXCLUDED.status = 'active'
        THEN COALESCE(public.listener_subscriptions.activated_at, now())
        ELSE NULL END,
      cancelled_at = CASE WHEN EXCLUDED.status = 'cancelled' THEN now() ELSE NULL END,
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_membership(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_membership(uuid, text, text, text) TO authenticated;
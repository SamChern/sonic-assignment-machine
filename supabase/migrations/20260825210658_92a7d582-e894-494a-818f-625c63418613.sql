REVOKE ALL ON FUNCTION public.has_org_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_org_write(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_org_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_org_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_org_write(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO authenticated, service_role;
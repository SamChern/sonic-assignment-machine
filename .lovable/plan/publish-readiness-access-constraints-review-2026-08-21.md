# Publish readiness: access constraints review

## Short answer

Yes — publishing is safe from an admin/user access standpoint. Verified just now:

- All admin screens (`/admin`, `/admin/integrations`, `/admin/ctv`, `/admin/pipeline`, `/admin/semantic`) redirect non-admins to `/` and render nothing until the admin role resolves.
- Real enforcement is at the database layer, not just the UI. The Intuizi ledger and identifier tables (`intuizi_identifiers`, `intuizi_ingest_files`, `intuizi_ingest_state`) allow read access only to signed-in users holding the `admin` role, and no client-side insert/update/delete path exists. So the new semantic-analysis and inspect-mapping screens cannot leak data to a non-admin even if someone visits the route directly.
- Privileged database routines run behind the admin gate, and privileged edge endpoints require either a service role call or an admin user.
- The security scan shows no critical findings — nothing blocks publishing.

## One open warning worth fixing first

`librosa_call_log` is readable by **any signed-in user**, including error messages and `audio_source_id` references that belong to other users' content. It is not public (anonymous users get nothing), so it is not a publish blocker, but it is broader than the rest of the app's rules.

Two other scan entries are informational only: the `category_feedback` insert policy note (expected: admin-only write path) and the `SECURITY DEFINER` executable warning, which is the intended pattern for the admin wrapper functions that check the role internally.

## Proposed work (optional, before publish)

1. Tighten `librosa_call_log` read access: replace the blanket signed-in read policy with one that allows a row only when the caller owns the referenced audio source, or when the caller is an admin. Rows with no `audio_source_id` become admin-only.
2. Confirm the admin telemetry panels that read this log still populate for admins after the change.
3. Re-run the security scan, then publish.

If you'd rather ship now, publishing is safe as-is and this can follow as a small hardening pass.

## Technical notes

- Change is a single migration: drop the `Signed in users can read call log` policy on `public.librosa_call_log`, add an owner-or-admin `SELECT` policy using an `EXISTS` join to `public.audio_sources` plus `has_role(auth.uid(), 'admin')`. Grants stay unchanged.
- No frontend changes needed; admin panels already query the log as an admin user.

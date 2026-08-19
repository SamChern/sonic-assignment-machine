# Turn on S3 sync and inspect the new inbound file

Goal: connect the inbound S3 bucket through the Lovable connector, get a safe "what's actually in the bucket" view (including this new file), then route it into the existing ingest pipeline once its real format is known.

## Current state (verified)

- `intuizi-ingest` already implements the full pipeline: bucket listing, normalize, per-identifier rollup, taxonomy tags, `analyze-audio` scoring, calibration + embeddings, with a DB lease, pause/park circuit breaker, and a file ledger.
- The S3 connection is **not linked** to this project — there is no `AWS_S3_API_KEY` secret, so the function stops at its `s3Configured()` guard and returns "Amazon S3 is not connected for this project yet". Nothing can be read from the bucket until that link exists.
- The reader (`_shared/intuizi.ts`) accepts only `.csv`, `.csv.gz`, and `.json`/`.jsonl`. Anything else raises "configure Intuizi to deliver CSV or gzipped CSV." A real tcpdump capture would hit that path, since a `LINUX_SLL2` capture is binary packet data with no rows to parse.
- Listing is scoped to the five report prefixes (`ctv/`, `apps/`, `visitation/`, `demographics/`, `origin/`), so a file dropped anywhere else is invisible to a normal run.

## Step 1 — Link the bucket

Open the Amazon S3 connect card and link the connection for the inbound Intuizi bucket. Read scope is enough; no write access is needed. This injects `AWS_S3_API_KEY` and unblocks the existing guard.

Note on the EC2/PEM access: SSH into the instance is a separate path and is not used by the app. The edge function reaches the bucket through the connector gateway, so the bucket itself (and its region/prefix) is what matters here, not the SSH key.

## Step 2 — Add a read-only bucket inspector

Add an `action: "inspect"` branch to `intuizi-ingest` that answers "what is in this bucket" without ingesting anything:

- List objects at the bucket root and under each report prefix, returning key, size, last-modified, and etag.
- For a given `object_key`, do a HEAD for content type/length, then fetch the first few KB via a signed URL and classify from the magic bytes: gzip (`1f 8b`), pcap (`d4c3b2a1` / `a1b2c3d4`), pcapng (`0a0d0d0a`), or text/CSV — and for text, return the header line and a couple of sample rows.
- No ledger writes, no scoring, no calibration side effects.

This is what tells us whether the new file is a genuine packet capture or an ordinary report that happened to be moved by a box running tcpdump.

## Step 3 — Surface it on the Integration Status page

On `/admin/pipeline`, add a "Bucket inspector" panel to the inbound-S3 stage: a Refresh button that lists objects, and clicking a row shows the classification plus the sampled header/rows. Errors from the gateway are shown verbatim (status + body) so a permissions or region problem is obvious.

## Step 4 — Ingest, based on what Step 2 finds

- **If it is a CSV/gzip/JSONL report:** run it through the existing path — `run_now` with `object_key` plus its `report_type`. If it sits outside the five prefixes, either have it delivered under the right prefix or ingest it once by explicit key. No parser changes needed.
- **If it is a real pcap/pcapng:** do not push it through the report normalizer. Report it as an unsupported inbound artifact (it carries packet frames, not identifier-level signals) and skip it in the ledger so it stops appearing as pending work. Building a capture parser would be separate work, and worth a quick conversation first about whether that file is even meant to land in this bucket.

## Technical notes

- Files touched: `supabase/functions/intuizi-ingest/index.ts` (new `inspect` action), `supabase/functions/_shared/s3.ts` (HEAD + ranged sample helper), `src/pages/IntegrationStatus.tsx` (inspector panel).
- The inspector stays admin-only, reusing the existing admin-JWT check in the function.
- Sampling reads at most a few KB per object via a signed read URL, so a large or binary file is never pulled into the function.
- Object-key classification is by magic bytes, not file extension, so a mislabelled `.csv` is caught before parsing.

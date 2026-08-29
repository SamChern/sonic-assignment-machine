"""Intuizi ingest worker (Step 2.5) — DuckDB decode on EC2.

Why this exists
---------------
`intuizi-ingest` used to read Parquet, normalize rows AND enqueue scoring inside
one edge invocation. Parquet decode is CPU-heavy and unbounded in size, so runs
died with IDLE_TIMEOUT (150s) or WORKER_RESOURCE_LIMIT (546) before finishing a
single large file.

The edge function is now a control plane: it discovers objects, writes the ledger
row and puts one SQS message per file on the queue. This process is the consumer:

    SQS message -> claim callback -> DuckDB read slice from S3 ->
    normalize rows -> POST batches to `ingest-worker-callback` ->
    complete (done | partial) -> delete message

Everything downstream is unchanged: the callback upserts into
`intuizi_score_queue` and `intuizi-score-worker` still does the ontology scoring.

Safety properties
-----------------
* Bounded work per message: `MAX_ROWS_PER_MESSAGE` rows, then checkpoint and
  re-queue the remainder from the saved cursor.
* Idempotent: every batch is keyed on (object_key, identifier) server-side, and
  the cursor is persisted with the batch that produced it, so a redelivered SQS
  message never double-counts.
* Heartbeats: each batch callback refreshes `heartbeat_at`, which is what lets
  the control plane re-dispatch a file whose worker died.
* Single-flight per file: the claim callback marks the ledger row `processing`;
  the control plane skips files with a fresh heartbeat.

Config (environment / systemd EnvironmentFile):
    SUPABASE_URL             https://<ref>.supabase.co
    INGEST_WORKER_SECRET     shared secret, matches the edge function secret
    MODE                     "pull" (default, queue-free) or "sqs"
    SQS_QUEUE_URL            sqs mode only: queue the control plane dispatches to
    AWS_REGION               region for SQS + S3
    AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   read on the bucket, consume on the queue
    S3_BUCKET                inbound delivery bucket
    MAX_ROWS_PER_MESSAGE     optional, default 200000
    BATCH_ROWS               optional callback batch size, default 1000
    POLL_SECONDS             pull mode only: sleep when there is no work, default 20

Pull mode (default)
-------------------
No queue, no extra AWS permissions: the worker asks `ingest-worker-callback` for
a lease (`phase: "lease"`), which atomically claims the oldest pending ledger row
with FOR UPDATE SKIP LOCKED and returns its resume cursor. Everything after the
lease — decode, normalize, progress/complete callbacks — is identical to the SQS
path, and both modes stay idempotent because the ledger cursor is the only source
of truth.
"""


from __future__ import annotations

import json
import logging
import os
import re
import signal
import socket
import sys
import time
import uuid
from typing import Any, Dict, Iterable, List, Optional

import boto3
import duckdb
import requests

from normalize import merge_by_identifier, normalize_row, pick


log = logging.getLogger("ingest-worker")

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
WORKER_SECRET = os.environ["INGEST_WORKER_SECRET"]
MODE = os.environ.get("MODE", "pull").strip().lower()
# Queue-free by default: pull mode needs no SQS URL and no queue permissions.
QUEUE_URL = os.environ.get("SQS_QUEUE_URL", "")
REGION = os.environ.get("AWS_REGION", "us-west-2")
BUCKET = os.environ["S3_BUCKET"]

MAX_ROWS_PER_MESSAGE = int(os.environ.get("MAX_ROWS_PER_MESSAGE", "200000"))
# 250 by default: the scoring queue is a large, six-index table, and a 1000-row
# upsert against it crossed the database statement timeout. The control plane can
# retune this from the Control Room (`ingest.worker_batch_rows`).
BATCH_ROWS = min(int(os.environ.get("BATCH_ROWS", "250")), 2000)
# Above this row count a file is summarised into subject x taxonomy x day rollups
# instead of queued device by device. Overridden by the control plane's config.
ROLLUP_ROW_THRESHOLD = int(os.environ.get("ROLLUP_ROW_THRESHOLD", "5000000"))
ROLLUP_CHUNK = 5_000
READ_CHUNK = 50_000
WAIT_SECONDS = 20
POLL_SECONDS = max(int(os.environ.get("POLL_SECONDS", "20")), 5)
VISIBILITY_SECONDS = 900



CALLBACK_URL = f"{SUPABASE_URL}/functions/v1/ingest-worker-callback"
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"

_stop = False


def _handle_stop(*_: Any) -> None:
    """Finish the in-flight file, then exit — never abandon a claimed message."""
    global _stop
    _stop = True
    log.info("shutdown requested; finishing current message")


class Callback:
    """Thin client for `ingest-worker-callback` with bounded retries."""

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update({
            "content-type": "application/json",
            "x-worker-secret": WORKER_SECRET,
        })

    def post(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        payload = {**payload, "worker_id": WORKER_ID}
        last: Optional[Exception] = None
        # A write that timed out on a busy database is not a bad payload: the
        # ledger cursor is untouched, so re-sending the same slice is safe and
        # cheaper than losing a 40M-row file. Retry those far longer.
        for attempt in range(1, 11):
            try:
                res = self.session.post(CALLBACK_URL, json=payload, timeout=120)
            except requests.RequestException as e:  # network blip
                last = e
            else:
                if res.status_code < 300:
                    return res.json()
                # 4xx other than 429 is our bug: the payload will never be accepted.
                if 400 <= res.status_code < 500 and res.status_code != 429:
                    raise RuntimeError(
                        f"callback rejected ({res.status_code}): {res.text[:400]}"
                    )
                last = RuntimeError(f"callback {res.status_code}: {res.text[:200]}")
                if res.status_code == 503:
                    log.warning(
                        "callback busy (attempt %d), backend asked us to retry: %s",
                        attempt, res.text[:200],
                    )
            time.sleep(min(120, 2 ** attempt))
        raise RuntimeError(f"callback failed after retries: {last}")

    def heartbeat(self, stats: Dict[str, Any]) -> None:
        """Best-effort liveness ping — one attempt, never blocks the work loop."""
        try:
            self.session.post(
                CALLBACK_URL,
                json={
                    "phase": "heartbeat",
                    "worker_id": WORKER_ID,
                    "host": socket.gethostname(),
                    "stats": stats,
                },
                timeout=15,
            )
        except Exception as e:  # noqa: BLE001
            log.debug("heartbeat failed: %s", str(e)[:200])




def s3_uri(object_key: str) -> str:
    return f"s3://{BUCKET}/{object_key}"


def connect_duckdb() -> duckdb.DuckDBPyConnection:
    """DuckDB with httpfs so Parquet row groups stream straight from S3."""
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute(f"SET s3_region='{REGION}';")
    key = os.environ.get("AWS_ACCESS_KEY_ID")
    secret = os.environ.get("AWS_SECRET_ACCESS_KEY")
    if key and secret:
        con.execute(f"SET s3_access_key_id='{key}';")
        con.execute(f"SET s3_secret_access_key='{secret}';")
    if os.environ.get("AWS_SESSION_TOKEN"):
        con.execute(f"SET s3_session_token='{os.environ['AWS_SESSION_TOKEN']}';")
    # Keep the worker inside its box's memory even on very wide row groups.
    con.execute("SET memory_limit='2GB'; SET threads=2;")
    return con


def reader_sql(object_key: str) -> str:
    """Reader expression per delivery format (Parquet, CSV, gzipped CSV)."""
    lower = object_key.lower()
    uri = s3_uri(object_key)
    if lower.endswith(".parquet"):
        return f"read_parquet('{uri}')"
    return (
        f"read_csv_auto('{uri}', header=true, all_varchar=true, "
        "sample_size=-1, ignore_errors=true)"
    )


def total_rows(con: duckdb.DuckDBPyConnection, object_key: str) -> int:
    row = con.execute(f"SELECT count(*) FROM {reader_sql(object_key)}").fetchone()
    return int(row[0]) if row else 0


def read_slice(
    con: duckdb.DuckDBPyConnection,
    object_key: str,
    offset: int,
    limit: int,
) -> List[Dict[str, Any]]:
    """One bounded window of rows as dicts. DuckDB pushes LIMIT/OFFSET down."""
    rel = con.execute(
        f"SELECT * FROM {reader_sql(object_key)} LIMIT {int(limit)} OFFSET {int(offset)}"
    )
    columns = [d[0] for d in rel.description or []]
    return [dict(zip(columns, row)) for row in rel.fetchall()]


def batched(items: List[Dict[str, Any]], size: int) -> Iterable[List[Dict[str, Any]]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def row_day(row: Dict[str, Any]) -> Optional[str]:
    """Best-effort event date for a rollup row (YYYY-MM-DD), or None."""
    raw = pick(row, "date", "event_date", "day", "dt", "timestamp", "event_time")
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", raw)
    return m.group(0) if m else None


def process_rollups(
    con: duckdb.DuckDBPyConnection,
    cb: Callback,
    base: Dict[str, Any],
    object_key: str,
    report_type: str,
    grand_total: int,
) -> Dict[str, Any]:
    """Summary path for very large files.

    Queueing one scoring task per device row is what buried the 40M-row files: the
    work is quadratic in impressions, not in people. Here the worker folds rows
    into `(subject, taxonomy_code, day)` weights on the box and ships them to
    `ingest_rollups`, which the backend promotes into one scoring task per
    subject. Weights are additive on the server, so flushing partial aggregates
    is safe and keeps memory flat on a 7 GB instance.
    """
    started = time.monotonic()
    agg: Dict[tuple, float] = {}
    sent = 0
    read = 0
    skipped = 0
    first_flush = True

    def flush(force: bool = False) -> None:
        nonlocal agg, sent, first_flush
        if not agg or (not force and len(agg) < 200_000):
            return
        rows = [
            {"subject_key": s, "taxonomy_code": c, "day": d, "weight": w}
            for (s, c, d), w in agg.items()
        ]
        for chunk in batched(rows, ROLLUP_CHUNK):
            cb.post({
                **base,
                "phase": "rollups",
                "rows": chunk,
                # Clear stale rows for this object exactly once per run so a
                # re-run cannot double-count.
                "replace": first_flush,
            })
            first_flush = False
            sent += len(chunk)
        agg = {}

    offset = 0
    while offset < grand_total and not _stop:
        want = min(READ_CHUNK, grand_total - offset)
        rows = read_slice(con, object_key, offset, want)
        if not rows:
            break
        for raw in rows:
            norm = normalize_row(report_type, raw)
            if not norm or not norm.get("tags"):
                skipped += 1
                continue
            day = row_day(raw)
            subject = norm["identifier"][:512]
            for t in norm["tags"]:
                code = str(t.get("code") or "")[:200]
                if not code:
                    continue
                key = (subject, code, day)
                agg[key] = agg.get(key, 0.0) + float(t.get("weight") or 1)
        offset += len(rows)
        read += len(rows)
        flush()
        cb.post({
            **base,
            "phase": "progress",
            "rows_read": len(rows),
            "rows_offset": offset,
            "total_rows": grand_total,
        })
        log.info(
            "trace=%s key=%s rollup rows=%d/%d staged=%d pending=%d",
            base.get("trace_id"), object_key, offset, grand_total, sent, len(agg),
        )

    flush(force=True)
    complete = offset >= grand_total
    if complete:
        # `loaded` tells the backend the rollups are staged; it promotes them into
        # scoring tasks inline and closes the ledger row out as `done`.
        cb.post({**base, "phase": "loaded", "rows": sent})
    else:
        cb.post({
            **base,
            "phase": "complete",
            "complete": False,
            "rows_read": 0,
            "rows_offset": offset,
            "total_rows": grand_total,
        })

    return {
        "object_key": object_key,
        "mode": "rollups",
        "trace_id": base.get("trace_id"),
        "rows_read": read,
        "rows_offset": offset,
        "total_rows": grand_total,
        "rollup_rows_staged": sent,
        "rows_without_taxonomy": skipped,
        "complete": complete,
        "seconds": round(time.monotonic() - started, 1),
    }



def process_message(
    con: duckdb.DuckDBPyConnection,
    cb: Callback,
    msg: Dict[str, Any],
) -> Dict[str, Any]:
    """Decode + normalize one file slice and report it. Returns a run summary."""
    object_key = msg["object_key"]
    report_type = msg.get("report_type") or "ctv"
    file_id = msg.get("file_id")
    trace_id = msg.get("trace_id") or f"worker-{uuid.uuid4().hex[:12]}"
    offset = int(msg.get("rows_offset") or 0)
    slice_cap = min(int(msg.get("max_rows") or MAX_ROWS_PER_MESSAGE), MAX_ROWS_PER_MESSAGE)

    base = {
        "file_id": file_id,
        "object_key": object_key,
        "report_type": report_type,
        "trace_id": trace_id,
        "activation_id": msg.get("activation_id"),
        "owner_id": msg.get("owner_id"),
    }
    cb.post({**base, "phase": "claim"})

    started = time.monotonic()
    grand_total = total_rows(con, object_key)

    # Very large deliveries are impression logs, not people: summarise them.
    if grand_total >= ROLLUP_ROW_THRESHOLD:
        log.info(
            "trace=%s key=%s rows=%d >= rollup threshold %d; using summary mode",
            trace_id, object_key, grand_total, ROLLUP_ROW_THRESHOLD,
        )
        return process_rollups(con, cb, base, object_key, report_type, grand_total)

    read = 0
    queued = 0
    skipped = 0


    while read < slice_cap and offset < grand_total and not _stop:
        want = min(READ_CHUNK, slice_cap - read, grand_total - offset)
        rows = read_slice(con, object_key, offset, want)
        if not rows:
            break

        normalized = [n for n in (normalize_row(report_type, r) for r in rows) if n]
        skipped += len(rows) - len(normalized)
        tasks = merge_by_identifier(normalized)

        offset += len(rows)
        read += len(rows)

        # Cursor travels with the batch that produced it: if the process dies
        # after this call, the resume starts exactly here.
        if tasks:
            for batch in batched(tasks, BATCH_ROWS):
                res = cb.post({
                    **base,
                    "phase": "progress",
                    "identifiers": batch,
                    "rows_read": 0,
                    "rows_offset": offset,
                    "total_rows": grand_total,
                })
                queued += int(res.get("identifiers_queued") or 0)

        # Account the rows once, separately from the identifier batches, so
        # `processed_rows` can never be inflated by a multi-batch chunk.
        cb.post({
            **base,
            "phase": "progress",
            "rows_read": len(rows),
            "rows_offset": offset,
            "total_rows": grand_total,
        })
        log.info(
            "trace=%s key=%s rows=%d/%d queued=%d",
            trace_id, object_key, offset, grand_total, queued,
        )

    complete = offset >= grand_total
    cb.post({
        **base,
        "phase": "complete",
        "complete": complete,
        "rows_read": 0,
        "rows_offset": offset,
        "total_rows": grand_total,
    })

    return {
        "object_key": object_key,
        "trace_id": trace_id,
        "rows_read": read,
        "rows_offset": offset,
        "total_rows": grand_total,
        "identifiers_queued": queued,
        "rows_without_taxonomy": skipped,
        "complete": complete,
        "seconds": round(time.monotonic() - started, 1),
    }


def apply_remote_config(cb: Callback) -> None:
    """Pull the operator's ingest knobs from the Control Room at startup."""
    global BATCH_ROWS, ROLLUP_ROW_THRESHOLD
    try:
        cfg = (cb.post({"phase": "config"}) or {}).get("config") or {}
    except Exception as e:  # noqa: BLE001 — env defaults are fine
        log.warning("could not fetch remote config, using env defaults: %s", str(e)[:200])
        return
    batch = int(cfg.get("batch_rows") or 0)
    if batch > 0:
        BATCH_ROWS = min(batch, 2000)
    threshold = int(cfg.get("rollup_row_threshold") or 0)
    if threshold > 0:
        ROLLUP_ROW_THRESHOLD = threshold
    log.info(
        "config: batch_rows=%d rollup_row_threshold=%d",
        BATCH_ROWS, ROLLUP_ROW_THRESHOLD,
    )


def run_pull(cb: Callback, con: duckdb.DuckDBPyConnection) -> None:
    """Queue-free loop: lease a file from the ledger, process it, repeat."""
    log.info("worker %s pulling leases from %s", WORKER_ID, CALLBACK_URL)
    apply_remote_config(cb)
    idle = 0
    lease_fails = 0
    files_done = 0
    cb.heartbeat({"state": "starting", "mode": "pull"})
    while not _stop:
        try:
            res = cb.post({"phase": "lease"})
        except Exception as e:  # noqa: BLE001 — transient callback trouble
            lease_fails += 1
            # A 5xx/HTML gateway page means the backend (or its pooler) is
            # saturated. Hammering it every POLL_SECONDS makes recovery slower,
            # so back off exponentially up to 10 minutes and keep the process
            # alive — the ledger cursor is already checkpointed.
            wait = min(600, POLL_SECONDS * (2 ** min(lease_fails, 6)))
            log.error(
                "lease failed (%d in a row); backend looks busy, sleeping %ds: %s",
                lease_fails, wait, str(e)[:300],
            )
            cb.heartbeat({"state": "backend_busy", "lease_failures": lease_fails})
            time.sleep(wait)
            continue
        lease_fails = 0


        lease = res.get("lease")
        if not lease:
            if idle == 0:
                log.info("no pending files; waiting for the control plane to discover more")
            idle += 1
            # An idle worker is still a live worker: keep the admin health card
            # green so "no files" never looks like "worker died".
            if idle % 3 == 1:
                cb.heartbeat({"state": "idle", "idle_polls": idle, "files_done": files_done})
            time.sleep(POLL_SECONDS)
            continue

        idle = 0
        msg = {
            "file_id": lease.get("file_id"),
            "object_key": lease.get("object_key"),
            "report_type": lease.get("report_type"),
            "trace_id": lease.get("trace_id"),
            "rows_offset": lease.get("rows_offset") or 0,
        }
        log.info("claimed %s at row %s", msg["object_key"], msg["rows_offset"])
        cb.heartbeat({"state": "processing", "object_key": msg["object_key"]})
        try:
            summary = process_message(con, cb, msg)
            files_done += 1
            log.info("done %s", json.dumps(summary))

        except Exception as e:  # noqa: BLE001 — park the file, keep the worker up
            log.exception("file failed: %s", e)
            try:
                cb.post({
                    "file_id": msg["file_id"],
                    "object_key": msg["object_key"],
                    "trace_id": msg["trace_id"],
                    "phase": "failed",
                    "error": str(e)[:1000],
                })
            except Exception:  # noqa: BLE001
                log.exception("could not report failure to callback")
            time.sleep(5)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    cb = Callback()
    con = connect_duckdb()

    if MODE != "sqs":
        run_pull(cb, con)
        log.info("worker stopped")
        return 0

    if not QUEUE_URL:
        log.error("MODE=sqs needs SQS_QUEUE_URL; set MODE=pull for the queue-free path")
        return 2

    sqs = boto3.client("sqs", region_name=REGION)
    log.info("worker %s polling %s", WORKER_ID, QUEUE_URL.rsplit("/", 1)[-1])


    while not _stop:
        got = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=WAIT_SECONDS,
            VisibilityTimeout=VISIBILITY_SECONDS,
        )
        for raw in got.get("Messages", []):
            try:
                msg = json.loads(raw["Body"])
            except json.JSONDecodeError:
                log.error("undecodable message, deleting: %s", raw["Body"][:200])
                sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=raw["ReceiptHandle"])
                continue

            try:
                summary = process_message(con, cb, msg)
                log.info("done %s", json.dumps(summary))
                # Only delete after the ledger knows the cursor: a crash before
                # this leaves the message for redelivery, which resumes safely.
                sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=raw["ReceiptHandle"])
            except Exception as e:  # noqa: BLE001 — report, then let SQS retry
                log.exception("message failed: %s", e)
                try:
                    cb.post({
                        "file_id": msg.get("file_id"),
                        "object_key": msg.get("object_key"),
                        "trace_id": msg.get("trace_id"),
                        "phase": "failed",
                        "error": str(e)[:1000],
                    })
                except Exception:  # noqa: BLE001
                    log.exception("could not report failure to callback")
                # Leave the message on the queue (visibility timeout) so the DLQ
                # policy decides when to give up.

    log.info("worker stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())

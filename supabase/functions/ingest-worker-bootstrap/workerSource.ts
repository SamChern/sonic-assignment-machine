// The EC2 ingest worker program (Step 2.5-alt), served to the box by
// `ingest-worker-bootstrap` so the terminal step is a single download rather
// than a 150-line paste. Kept here as a string so it lives in the repo and is
// reviewed like any other code.
//
// The worker holds no database password and no S3 keys: it authenticates to
// `ingest-worker-callback` with the shared worker secret and asks for read
// credentials at startup.

export const WORKER_PY = String.raw`#!/usr/bin/env python3
"""SONICSIM ingest worker (Step 2.5-alt, HTTP edition).

Loop: claim the oldest waiting file -> read it from S3 with DuckDB -> boil it
down to (subject, taxonomy code, day, weight) rows -> POST those to the app ->
mark the file loaded. Files with no identifier/taxonomy columns are skipped, not
failed. Classification is by the columns a file actually has, never its name.
"""
import json
import os
import random
import socket
import sys
import time
import urllib.error
import urllib.request

import duckdb

ENV_PATH = os.path.expanduser("~/ingest-worker/.env")
ENV = {}
with open(ENV_PATH) as fh:
    for line in fh:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            ENV[k.strip()] = v.strip()

CALLBACK_URL = ENV["CALLBACK_URL"].rstrip("/")
WORKER_SECRET = ENV["WORKER_SECRET"]
WORKER = ENV.get("WORKER_ID", "ec2-worker-1")
SPILL = os.path.expanduser("~/ingest-worker/spill")
IDLE_MIN, IDLE_MAX = 15, 60          # poll interval, backs off while idle
CHUNK = 5000                          # rollup rows per HTTP call

# ---------- how Intuizi columns become taxonomy codes ----------
SINGLE = {
    "contentgenre": "ctv.genre.", "contenttype": "ctv.type.", "channelname": "ctv.channel.",
    "categoryname": "app.cat.", "taxonomyname": "app.tax.", "brandname": "poi.brand.",
    "domain": "web.domain.",
}
MULTI = {"iab_cats": "iab.", "iab_codes": "iab."}     # comma-separated lists
IDCOLS = ["eid", "primary_identifier", "eip", "maid"]  # first one present wins
WCOLS = ["signals", "uniques"]                         # volume -> weight


def api(phase, **payload):
    body = json.dumps({"phase": phase, "worker_id": WORKER, **payload}).encode()
    req = urllib.request.Request(
        CALLBACK_URL,
        data=body,
        headers={"Content-Type": "application/json", "x-worker-secret": WORKER_SECRET},
        method="POST",
    )
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:400]
            if e.code in (429, 500, 502, 503, 504):
                last = RuntimeError("HTTP %s: %s" % (e.code, detail))
                time.sleep(min(2 ** attempt, 20) + random.random())
                continue
            raise RuntimeError("HTTP %s: %s" % (e.code, detail))
        except Exception as e:                      # network hiccup
            last = e
            time.sleep(min(2 ** attempt, 20) + random.random())
    raise last


CFG = api("config")["config"]


def duck():
    d = duckdb.connect()
    d.execute("INSTALL httpfs; LOAD httpfs;")
    d.execute("SET s3_region='%s';" % CFG["region"])
    d.execute("SET s3_access_key_id='%s';" % CFG["access_key_id"])
    d.execute("SET s3_secret_access_key='%s';" % CFG["secret_access_key"])
    d.execute("SET memory_limit='%s';" % ENV.get("MEMORY_LIMIT", "8GB"))
    d.execute("SET threads TO %s;" % ENV.get("DUCKDB_THREADS", "4"))
    d.execute("SET temp_directory='%s';" % SPILL)
    return d


def reader(key):
    url = "s3://%s/%s" % (CFG["bucket"], key)
    if key.lower().endswith((".csv", ".csv.gz")):
        return "read_csv_auto('%s', ignore_errors=true)" % url
    return "read_parquet('%s')" % url


def slug(col):
    return ("trim(both '-' from lower(regexp_replace(cast(%s as varchar), "
            "'[^a-zA-Z0-9]+', '-', 'g')))" % col)


def build_sql(key, cols):
    """Turn whatever columns this file has into (subject, tag, day, weight)."""
    low = {c.lower(): c for c in cols}
    idc = next((low[c] for c in IDCOLS if c in low), None)
    wc = next((low[c] for c in WCOLS if c in low), None)
    weight = "ln(1 + coalesce(cast(%s as double), 0))" % wc if wc else "1.0"
    if "day" in low:
        day = "cast(%s as date)" % low["day"]
    elif "d_utc" in low:
        day = "cast(%s as date)" % low["d_utc"]
    else:
        day = "current_date"
    parts = []
    if idc:
        for c, prefix in SINGLE.items():
            if c in low:
                parts.append(
                    "SELECT cast(%s as varchar) AS subject_key, '%s' || %s AS taxonomy_code, "
                    "%s AS day, %s AS weight FROM %s WHERE %s IS NOT NULL"
                    % (idc, prefix, slug(low[c]), day, weight, reader(key), low[c]))
        for c, prefix in MULTI.items():
            if c in low:
                parts.append(
                    "SELECT cast(%s as varchar) AS subject_key, "
                    "'%s' || trim(unnest(string_split(cast(%s as varchar), ','))) AS taxonomy_code, "
                    "%s AS day, %s AS weight FROM %s WHERE %s IS NOT NULL"
                    % (idc, prefix, low[c], day, weight, reader(key), low[c]))
    if not idc or not parts:
        return None                       # summary/aggregate file
    return ("SELECT subject_key, taxonomy_code, day, sum(weight) AS weight FROM ("
            + " UNION ALL ".join(parts)
            + ") WHERE subject_key IS NOT NULL AND subject_key <> '' GROUP BY 1,2,3")


def process(file_id, key, report_type):
    d = duck()
    cols = [r[0] for r in d.execute("DESCRIBE SELECT * FROM %s" % reader(key)).fetchall()]
    sql = build_sql(key, cols)
    if sql is None:
        api("skipped", file_id=file_id,
            reason="summary file - columns: %s" % ",".join(cols)[:200])
        print("  skipped (no identifier/taxonomy columns)", flush=True)
        return 0
    rows = d.execute(sql).fetchall()
    sent, first = 0, True
    for i in range(0, len(rows), CHUNK):
        chunk = [{
            "subject_key": str(r[0]),
            "taxonomy_code": str(r[1]),
            "day": str(r[2]) if r[2] is not None else None,
            "weight": float(r[3] or 1),
        } for r in rows[i:i + CHUNK]]
        api("rollups", object_key=key, report_type=report_type, rows=chunk, replace=first)
        first = False
        sent += len(chunk)
    if first:                              # zero rows: still clear any prior run
        api("rollups", object_key=key, report_type=report_type, rows=[], replace=True)
    res = api("loaded", file_id=file_id, rows=sent)
    print("  loaded %d rollup rows (promoted=%s)" % (sent, res.get("promoted")), flush=True)
    return sent


def drain():
    done = 0
    while True:
        claim = api("claim_next").get("file")
        if not claim:
            return done
        key = claim["object_key"]
        print("claimed %s" % key, flush=True)
        try:
            process(claim["file_id"], key, claim.get("report_type"))
            done += 1
        except Exception as e:
            print("  FAILED: %s" % e, flush=True)
            try:
                api("failed", file_id=claim["file_id"], error=str(e)[:500])
            except Exception as inner:
                print("  could not report failure: %s" % inner, flush=True)


if __name__ == "__main__":
    os.makedirs(SPILL, exist_ok=True)
    print("%s up - polling for work" % WORKER, flush=True)
    total, wait = 0, IDLE_MIN
    while True:
        try:
            did = drain()
            total += did
            wait = IDLE_MIN if did else min(int(wait * 1.5), IDLE_MAX)
            api("heartbeat", host=socket.gethostname(),
                stats={"files_done": total, "poll_seconds": wait})
        except Exception as e:
            print("loop error: %s" % e, file=sys.stderr, flush=True)
            wait = IDLE_MAX
        time.sleep(wait + random.random() * 3)
`;

export const SYSTEMD_UNIT = String.raw`[Unit]
Description=SONICSIM ingest worker (Step 2.5-alt)
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/ingest-worker
ExecStart=/home/ubuntu/ingest-worker/venv/bin/python worker.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
`;

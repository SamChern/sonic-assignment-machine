# server_rest.py — Plain HTTP/REST wrapper around the librosa analysis pipeline.
#
# This is the *non-MCP* sibling of server_extended.py. It exposes a small,
# predictable JSON API so Lovable edge functions (and any other client) can
# call librosa over plain HTTPS without having to speak MCP / SSE.
#
# Endpoints:
#   GET  /health                     -> {"ok": true, "service": "librosa-rest", ...}
#   POST /analyze    { "audio_url"   -> downloads + extracts tempo, key, mfcc, chroma, duration
#                      | "audio_b64": "..." | "youtube_url": "..." }
#   POST /tool/{name}                -> generic passthrough to any function in
#                                       server_extended.py (advanced / debugging)
#
# Auth: every request must carry `Authorization: Bearer <TOKEN>` matching the
#       env var LIBROSA_REST_TOKEN. nginx adds an outer auth check too — the
#       in-process check is defense in depth in case someone proxies directly.
#
# Run:  uvicorn server_rest:app --host 127.0.0.1 --port 8766
#       (see librosa-rest.service for the systemd version)

from __future__ import annotations

import base64
import os
import tempfile
import time
import uuid
from typing import Any

import librosa
import numpy as np
import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Reuse the extended server's tool implementations so we have a single source
# of truth for librosa logic. server_extended.py defines a `mcp` object with
# the @mcp.tool()-decorated functions; we import the underlying callables.
import server_extended as ext  # noqa: E402

APP_VERSION = "1.0.0"
TOKEN_ENV = "LIBROSA_REST_TOKEN"

app = FastAPI(
    title="Librosa REST",
    version=APP_VERSION,
    description="Plain HTTP wrapper around librosa analysis tools (sibling of the MCP server).",
)


def _require_auth(request: Request) -> None:
    expected = os.environ.get(TOKEN_ENV, "").strip()
    if not expected:
        # Misconfigured server — fail closed so we don't accidentally expose tools.
        raise HTTPException(status_code=500, detail=f"{TOKEN_ENV} not set on server")
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    if auth.split(" ", 1)[1].strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
def health(request: Request) -> dict[str, Any]:
    """Lightweight liveness check. Auth-protected so we don't leak the version
    string to anonymous internet scanners (nginx already requires the token)."""
    _require_auth(request)
    return {
        "ok": True,
        "service": "librosa-rest",
        "version": APP_VERSION,
        "librosa": librosa.__version__,
        "numpy": np.__version__,
    }


# ---------------------------------------------------------------------------
# /analyze — high-level endpoint covering the audio-fingerprint use case
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    """Provide ONE source — URL, base64 payload, or YouTube URL."""

    audio_url: str | None = Field(default=None, description="Direct HTTPS URL to an audio file (mp3/wav/flac/ogg).")
    audio_b64: str | None = Field(default=None, description="Base64-encoded audio bytes (mp3/wav).")
    youtube_url: str | None = Field(default=None, description="YouTube watch URL — uses pytubefix to fetch audio.")

    duration: float | None = Field(default=60.0, description="Max seconds to analyze (defaults to 60s preview).")
    n_mfcc: int = Field(default=13, ge=1, le=40)


def _download_to_tmp(url: str) -> str:
    suffix = os.path.splitext(url.split("?")[0])[1] or ".mp3"
    fd, path = tempfile.mkstemp(prefix=f"rest_{uuid.uuid4().hex[:8]}_", suffix=suffix)
    os.close(fd)
    with requests.get(url, stream=True, timeout=30) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for chunk in r.iter_content(chunk_size=64 * 1024):
                f.write(chunk)
    return path


def _b64_to_tmp(b64: str) -> str:
    fd, path = tempfile.mkstemp(prefix=f"rest_{uuid.uuid4().hex[:8]}_", suffix=".bin")
    os.close(fd)
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))
    return path


def _youtube_to_tmp(url: str) -> str:
    if ext.YouTube is None:
        raise HTTPException(status_code=500, detail="pytubefix not installed on server")
    yt = ext.YouTube(url)
    stream = yt.streams.filter(only_audio=True).order_by("abr").desc().first()
    if not stream:
        raise HTTPException(status_code=400, detail="No audio stream found for that YouTube URL")
    out_dir = tempfile.gettempdir()
    return stream.download(output_path=out_dir, filename=f"yt_{uuid.uuid4().hex[:8]}.m4a")


@app.post("/analyze")
def analyze(payload: AnalyzeRequest, request: Request) -> dict[str, Any]:
    _require_auth(request)
    started = time.time()

    sources_provided = sum(
        x is not None for x in (payload.audio_url, payload.audio_b64, payload.youtube_url)
    )
    if sources_provided != 1:
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one of: audio_url, audio_b64, youtube_url.",
        )

    try:
        if payload.audio_url:
            local_path = _download_to_tmp(payload.audio_url)
        elif payload.audio_b64:
            local_path = _b64_to_tmp(payload.audio_b64)
        else:
            local_path = _youtube_to_tmp(payload.youtube_url)  # type: ignore[arg-type]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch audio: {e}")

    try:
        # Load audio (librosa handles ffmpeg-decodable formats).
        y, sr = librosa.load(local_path, duration=payload.duration)

        # Core features ------------------------------------------------------
        duration_sec = float(librosa.get_duration(y=y, sr=sr))

        tempo_arr, beats = librosa.beat.beat_track(y=y, sr=sr)
        tempo_bpm = float(np.atleast_1d(tempo_arr)[0])

        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=payload.n_mfcc)
        mfcc_mean = mfcc.mean(axis=1).tolist()
        mfcc_std = mfcc.std(axis=1).tolist()

        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_mean = chroma.mean(axis=1).tolist()
        # Estimated key as the chroma bin with strongest mean energy.
        pitch_classes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        key_idx = int(np.argmax(chroma_mean))
        estimated_key = pitch_classes[key_idx]

        spectral_centroid = float(librosa.feature.spectral_centroid(y=y, sr=sr).mean())
        spectral_rolloff = float(librosa.feature.spectral_rolloff(y=y, sr=sr).mean())
        zero_crossing_rate = float(librosa.feature.zero_crossing_rate(y).mean())
        rms_energy = float(librosa.feature.rms(y=y).mean())
    finally:
        # Always clean up the downloaded file so we don't pile up /tmp.
        try:
            os.remove(local_path)
        except OSError:
            pass

    return {
        "ok": True,
        "elapsed_ms": int((time.time() - started) * 1000),
        "sample_rate": int(sr),
        "duration_sec": round(duration_sec, 3),
        "tempo_bpm": round(tempo_bpm, 2),
        "estimated_key": estimated_key,
        "mfcc_mean": [round(x, 4) for x in mfcc_mean],
        "mfcc_std": [round(x, 4) for x in mfcc_std],
        "chroma_mean": [round(x, 4) for x in chroma_mean],
        "spectral_centroid": round(spectral_centroid, 2),
        "spectral_rolloff": round(spectral_rolloff, 2),
        "zero_crossing_rate": round(zero_crossing_rate, 5),
        "rms_energy": round(rms_energy, 5),
    }


# ---------------------------------------------------------------------------
# /tool/{name} — generic passthrough to any function in server_extended
# ---------------------------------------------------------------------------

# Allow-list of names the REST API will dispatch. We deliberately avoid
# `getattr(ext, name)` over arbitrary input so callers can't reach helper
# functions or `os.system`.
_EXPOSED_TOOLS = {
    "load",
    "tempo",
    "mfcc",
    "chroma_cqt",
    "beat_track",
    "get_duration",
    "download_from_url",
    "download_from_youtube",
    # Extended (Lovable fork)
    "dtw",
    "viterbi",
    "viterbi_discriminative",
    "util_frame",
    "util_pad_center",
    "util_normalize",
    "util_stack_memory",
    "util_match_events",
    "util_match_intervals",
    "samples_to_time",
    "time_to_samples",
    "frames_to_time",
    "time_to_frames",
    "recurrence_matrix",
    "laplacian_segmentation",
}


@app.post("/tool/{name}")
async def call_tool(name: str, request: Request) -> JSONResponse:
    _require_auth(request)
    if name not in _EXPOSED_TOOLS:
        raise HTTPException(status_code=404, detail=f"Unknown tool: {name}")
    fn = getattr(ext, name, None)
    if not callable(fn):
        raise HTTPException(status_code=404, detail=f"Tool {name} is not callable on this server")

    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object of kwargs")

    try:
        result = fn(**body)
    except TypeError as e:
        raise HTTPException(status_code=400, detail=f"Bad arguments for {name}: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{name} failed: {e}")

    # Coerce numpy types to JSON-friendly values.
    return JSONResponse(_jsonify(result))


def _jsonify(obj: Any) -> Any:
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, dict):
        return {k: _jsonify(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonify(v) for v in obj]
    return obj

# server_semantic.py — CLAP text/audio embedding service (SONICSIM Step 2).
#
# Sibling of deploy/librosa-mcp/server_rest.py, same conventions: FastAPI behind
# gunicorn/uvicorn on loopback, nginx fronts with TLS + Bearer auth, systemd unit
# supervises. It runs on the SAME EC2 box as librosa-rest, on port 8769.
#
# Endpoints:
#   GET  /healthz                       -> model + bridge version currently loaded
#   POST /embed_text  {texts:[...]}     -> 512-d CLAP text vectors
#   POST /embed_audio {url}             -> 512-d CLAP audio vector
#   POST /bridge      {vectors, bridge_id} -> 1536-d projected vectors
#
# The bridge is an IDENTITY STUB until Step 8 trains a real 512->1536 MLP: it
# tiles + L2-normalizes the 512-d vector into 1536-d, which is deterministic,
# order-preserving, and good enough to wire and test the whole pipeline end to
# end. Swapping in trained weights changes nothing downstream — the app reads
# the active bridge from public.embedding_bridges.
#
# Auth: Authorization: Bearer <SEMANTIC_SVC_TOKEN>. Same defense-in-depth as
# librosa-rest (nginx checks too).
#
# Run: uvicorn server_semantic:app --host 127.0.0.1 --port 8769

from __future__ import annotations

import os
import tempfile
import time
from typing import Any
from urllib.parse import urlparse

import numpy as np
import requests
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

APP_VERSION = "1.0.0"
TOKEN_ENV = "SEMANTIC_SVC_TOKEN"
TEXT_DIM = 512
TARGET_DIM = 1536

# Audio fetch limits mirror the librosa service so a hostile URL can't wedge the box.
MAX_AUDIO_BYTES = int(os.environ.get("SEMANTIC_MAX_AUDIO_BYTES", 60 * 1024 * 1024))
FETCH_TIMEOUT = int(os.environ.get("SEMANTIC_FETCH_TIMEOUT", 60))

app = FastAPI(
    title="SonicSIM Semantic Service",
    version=APP_VERSION,
    description="LAION-CLAP text/audio embeddings + text<->audio bridge projection.",
)

_model = None
_model_name = os.environ.get("SEMANTIC_CLAP_CKPT", "630k-audioset-best")
_bridge_weights: dict[str, Any] = {}


def _require_auth(request: Request) -> None:
    expected = os.environ.get(TOKEN_ENV, "").strip()
    if not expected:
        raise HTTPException(status_code=500, detail=f"{TOKEN_ENV} not set on server")
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    if auth.split(" ", 1)[1].strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid Bearer token")


def _load_model():
    """Lazy-load CLAP so /healthz answers before the first (slow) model load."""
    global _model
    if _model is not None:
        return _model
    import laion_clap  # imported lazily: heavy torch import

    model = laion_clap.CLAP_Module(enable_fusion=False)
    ckpt = os.environ.get("SEMANTIC_CLAP_CKPT_PATH", "").strip()
    if ckpt:
        model.load_ckpt(ckpt)
    else:
        model.load_ckpt()  # downloads the default 630k-audioset checkpoint
    _model = model
    return _model


def _l2(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-9)


class EmbedTextBody(BaseModel):
    texts: list[str] = Field(..., min_length=1, max_length=256)


class EmbedAudioBody(BaseModel):
    url: str


class BridgeBody(BaseModel):
    vectors: list[list[float]] = Field(..., min_length=1, max_length=256)
    bridge_id: str | None = None
    weights_url: str | None = None


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "semantic-svc",
        "version": APP_VERSION,
        "model": _model_name,
        "model_loaded": _model is not None,
        "text_dim": TEXT_DIM,
        "target_dim": TARGET_DIM,
        "bridge": {
            "mode": "identity_stub" if not _bridge_weights else "trained",
            "loaded_ids": sorted(_bridge_weights.keys()),
        },
    }


@app.post("/embed_text")
def embed_text(body: EmbedTextBody, request: Request) -> dict[str, Any]:
    _require_auth(request)
    t0 = time.time()
    model = _load_model()
    vecs = model.get_text_embedding(body.texts, use_tensor=False)
    vecs = _l2(np.asarray(vecs, dtype=np.float32))
    return {
        "ok": True,
        "dims": int(vecs.shape[-1]),
        "vectors": vecs.tolist(),
        "duration_ms": int((time.time() - t0) * 1000),
    }


@app.post("/embed_audio")
def embed_audio(body: EmbedAudioBody, request: Request) -> dict[str, Any]:
    _require_auth(request)
    parsed = urlparse(body.url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="url must be http(s)")

    t0 = time.time()
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=True) as tmp:
        written = 0
        with requests.get(body.url, stream=True, timeout=FETCH_TIMEOUT) as r:
            r.raise_for_status()
            for chunk in r.iter_content(chunk_size=1 << 16):
                written += len(chunk)
                if written > MAX_AUDIO_BYTES:
                    raise HTTPException(status_code=413, detail="audio too large")
                tmp.write(chunk)
        tmp.flush()
        model = _load_model()
        vecs = model.get_audio_embedding_from_filelist([tmp.name], use_tensor=False)

    vecs = _l2(np.asarray(vecs, dtype=np.float32))
    return {
        "ok": True,
        "dims": int(vecs.shape[-1]),
        "vector": vecs[0].tolist(),
        "bytes": written,
        "duration_ms": int((time.time() - t0) * 1000),
    }


def _project_identity(v: np.ndarray) -> np.ndarray:
    """Deterministic 512 -> 1536 stub: tile 3x, then L2-normalize.

    Cosine similarity between two tiled vectors equals cosine similarity between
    the originals, so kNN behaviour in the 1536-d store is preserved exactly.
    """
    reps = TARGET_DIM // v.shape[-1]
    tail = TARGET_DIM - reps * v.shape[-1]
    out = np.concatenate([np.tile(v, reps), v[..., :tail]], axis=-1) if tail else np.tile(v, reps)
    return _l2(out)


def _load_bridge(bridge_id: str, weights_url: str | None) -> dict[str, np.ndarray] | None:
    """Fetch and cache trained MLP weights (npz with W1,b1,W2,b2). None => stub."""
    if not weights_url:
        return None
    cached = _bridge_weights.get(bridge_id)
    if cached is not None:
        return cached
    r = requests.get(weights_url, timeout=FETCH_TIMEOUT)
    r.raise_for_status()
    with tempfile.NamedTemporaryFile(suffix=".npz", delete=True) as tmp:
        tmp.write(r.content)
        tmp.flush()
        z = np.load(tmp.name)
        w = {k: np.asarray(z[k], dtype=np.float32) for k in z.files}
    _bridge_weights[bridge_id] = w
    return w


@app.post("/bridge")
def bridge(body: BridgeBody, request: Request) -> dict[str, Any]:
    _require_auth(request)
    v = np.asarray(body.vectors, dtype=np.float32)
    if v.ndim != 2 or v.shape[-1] != TEXT_DIM:
        raise HTTPException(status_code=400, detail=f"vectors must be Nx{TEXT_DIM}")

    weights = None
    if body.bridge_id:
        weights = _load_bridge(body.bridge_id, body.weights_url)

    if weights is None:
        out = _project_identity(v)
        mode = "identity_stub"
    else:
        h = np.maximum(v @ weights["W1"] + weights["b1"], 0.0)  # ReLU
        out = _l2(h @ weights["W2"] + weights["b2"])
        mode = "trained"
        if out.shape[-1] != TARGET_DIM:
            raise HTTPException(status_code=500, detail="bridge weights produce wrong dim")

    return {
        "ok": True,
        "mode": mode,
        "bridge_id": body.bridge_id,
        "dims": int(out.shape[-1]),
        "vectors": out.tolist(),
    }

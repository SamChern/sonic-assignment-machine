# server_extended.py — Lovable fork of hugohow/mcp-music-analysis.
#
# Adds the 4 capability buckets missing from upstream:
#   - Sequential modeling (dtw, viterbi, viterbi_discriminative)
#   - Utilities — array (frame, pad_center, normalize, stack_memory)
#   - Utilities — matching (match_events, match_intervals)
#   - Utilities — misc (samples_to_time, time_to_samples, frames_to_time, time_to_frames)
#   - Laplacian segmentation (recurrence_matrix, laplacian_segmentation)
#
# Convention (kept from upstream): time-series and matrices are persisted to
# tempfile-backed CSVs and tools accept/return the path strings. This lets
# multi-step pipelines chain across MCP calls without ballooning JSON payloads.

from __future__ import annotations

import os
import tempfile
from typing import Optional

import numpy as np
import librosa
import librosa.display  # noqa: F401  (registers display backends if used downstream)
import requests
import soundfile as sf  # noqa: F401  (kept for parity with upstream)
from fastmcp import FastMCP

try:
    from pytubefix import YouTube
except Exception:  # pragma: no cover — pytubefix is optional in dev
    YouTube = None  # type: ignore

mcp = FastMCP(
    "Music Analysis with librosa (extended)",
    dependencies=[
        "librosa", "matplotlib", "numpy", "scipy", "scikit-learn",
        "requests", "pytubefix",
    ],
    description=(
        "Lovable's extended MCP for librosa. Adds sequential modeling, array & "
        "matching utilities, misc time/sample conversions, and Laplacian "
        "segmentation on top of hugohow/mcp-music-analysis."
    ),
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _tmp(name: str, ext: str = "csv") -> str:
    return os.path.join(tempfile.gettempdir(), f"{name}.{ext}")


def _save_csv(arr: np.ndarray, name: str) -> str:
    path = _tmp(name)
    np.savetxt(path, arr, delimiter=";")
    return path


def _load_csv(path: str) -> np.ndarray:
    return np.loadtxt(path, delimiter=";")


def _basename(path: str) -> str:
    return os.path.splitext(os.path.basename(path))[0]


# ===========================================================================
# UPSTREAM TOOLS (kept verbatim in behavior so existing prompts still work)
# ===========================================================================

@mcp.tool()
def load(file_path: str, offset: float = 0.0, duration: Optional[float] = None) -> dict:
    """Load an audio file and persist the waveform to /tmp as CSV. Returns the path."""
    y, sr = librosa.load(path=file_path, offset=offset, duration=duration)
    name = _basename(file_path) + "_y"
    y_path = _save_csv(y, name)
    return {"y_path": y_path, "sr": int(sr)}


@mcp.tool()
def get_duration(path_audio_time_series_y: str) -> float:
    """Return the duration in seconds of a loaded waveform."""
    y = _load_csv(path_audio_time_series_y)
    return float(librosa.get_duration(y=y))


@mcp.tool()
def tempo(
    path_audio_time_series_y: str,
    hop_length: int = 512,
    start_bpm: float = 120,
    std_bpm: float = 1.0,
    ac_size: float = 8.0,
    max_tempo: float = 320.0,
) -> float:
    """Estimate tempo (BPM)."""
    y = _load_csv(path_audio_time_series_y)
    bpm = librosa.feature.tempo(
        y=y, hop_length=hop_length, start_bpm=start_bpm,
        std_bpm=std_bpm, ac_size=ac_size, max_tempo=max_tempo,
    )
    return float(bpm[0])


@mcp.tool()
def chroma_cqt(
    path_audio_time_series_y: str,
    hop_length: int = 512,
    fmin: Optional[float] = None,
    n_chroma: int = 12,
    n_octaves: int = 7,
) -> str:
    """Compute chroma-CQT and persist to CSV (note,time,amplitude). Returns CSV path."""
    y = _load_csv(path_audio_time_series_y)
    chroma = librosa.feature.chroma_cqt(
        y=y, hop_length=hop_length, fmin=fmin,
        n_chroma=n_chroma, n_octaves=n_octaves,
    )
    name = _basename(path_audio_time_series_y) + "_chroma_cqt"
    out = _tmp(name)
    notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    times = librosa.frames_to_time(np.arange(chroma.shape[1]), hop_length=hop_length)
    with open(out, "w") as f:
        f.write("note,time,amplitude\n")
        for i, note in enumerate(notes):
            for t_idx, amp in enumerate(chroma[i]):
                f.write(f"{note},{times[t_idx]},{amp}\n")
    return out


@mcp.tool()
def mfcc(path_audio_time_series_y: str, n_mfcc: int = 20) -> str:
    """Compute MFCCs and persist to CSV."""
    y = _load_csv(path_audio_time_series_y)
    m = librosa.feature.mfcc(y=y, n_mfcc=n_mfcc)
    return _save_csv(m, _basename(path_audio_time_series_y) + "_mfcc")


@mcp.tool()
def beat_track(
    path_audio_time_series_y: str,
    hop_length: int = 512,
    start_bpm: float = 120,
    tightness: int = 100,
    units: str = "frames",
) -> dict:
    """Beat tracking → {tempo, beats}."""
    y = _load_csv(path_audio_time_series_y)
    bpm, beats = librosa.beat.beat_track(
        y=y, hop_length=hop_length, start_bpm=start_bpm,
        tightness=tightness, units=units,
    )
    return {"tempo": float(bpm), "beats": beats.tolist()}


@mcp.tool()
def download_from_url(url: str) -> str:
    """Download a remote .mp3/.wav to /tmp and return the local path."""
    if not (url.endswith(".mp3") or url.endswith(".wav")):
        raise ValueError(f"URL: {url} is not a valid audio file (need .mp3 or .wav)")
    resp = requests.get(url, timeout=60)
    if resp.status_code != 200:
        raise ValueError(f"Failed to download {url}: HTTP {resp.status_code}")
    path = _tmp("downloaded_file", "mp3" if url.endswith(".mp3") else "wav")
    with open(path, "wb") as f:
        f.write(resp.content)
    return path


@mcp.tool()
def download_from_youtube(youtube_url: str) -> str:
    """Download audio-only from a YouTube URL to /tmp."""
    if YouTube is None:
        raise RuntimeError("pytubefix not installed")
    yt = YouTube(youtube_url)
    stream = yt.streams.get_audio_only()
    return stream.download(filename=yt.video_id + ".mp4", output_path=tempfile.gettempdir())


# ===========================================================================
# NEW: SEQUENTIAL MODELING
# ===========================================================================

@mcp.tool()
def dtw(path_x: str, path_y: str, subseq: bool = False, metric: str = "euclidean") -> dict:
    """Dynamic time warping between two feature matrices (CSVs).

    Returns {cost_path, wp_path, total_cost} where cost_path/wp_path are CSV
    file paths to the cost matrix and warping path respectively.
    """
    X = _load_csv(path_x)
    Y = _load_csv(path_y)
    D, wp = librosa.sequence.dtw(X=X, Y=Y, subseq=subseq, metric=metric)
    cost_path = _save_csv(D, f"{_basename(path_x)}__vs__{_basename(path_y)}_dtw_cost")
    wp_path = _save_csv(np.asarray(wp), f"{_basename(path_x)}__vs__{_basename(path_y)}_dtw_wp")
    total = float(D[-1, -1]) if D.size else 0.0
    return {"cost_path": cost_path, "wp_path": wp_path, "total_cost": total}


@mcp.tool()
def viterbi(path_log_prob: str, path_transition: str) -> str:
    """Viterbi decoding. log_prob (n_states × T) and transition (n_states × n_states) CSVs.
    Returns CSV path of the most likely state sequence (length T)."""
    p = _load_csv(path_log_prob)
    A = _load_csv(path_transition)
    states = librosa.sequence.viterbi(prob=np.exp(p), transition=A)
    return _save_csv(np.asarray(states, dtype=float), f"{_basename(path_log_prob)}_viterbi")


@mcp.tool()
def viterbi_discriminative(path_prob: str, path_transition: str) -> str:
    """Discriminative Viterbi decoding. Same shapes as viterbi(); prob is posterior."""
    p = _load_csv(path_prob)
    A = _load_csv(path_transition)
    states = librosa.sequence.viterbi_discriminative(prob=p, transition=A)
    return _save_csv(np.asarray(states, dtype=float), f"{_basename(path_prob)}_viterbi_disc")


# ===========================================================================
# NEW: UTILITIES — ARRAY
# ===========================================================================

@mcp.tool()
def util_frame(path_x: str, frame_length: int, hop_length: int, axis: int = -1) -> str:
    """librosa.util.frame — slice a 1-D series into overlapping frames. Returns CSV path."""
    x = _load_csv(path_x)
    framed = librosa.util.frame(x, frame_length=frame_length, hop_length=hop_length, axis=axis)
    return _save_csv(framed, f"{_basename(path_x)}_framed")


@mcp.tool()
def util_pad_center(path_x: str, size: int, axis: int = -1) -> str:
    """Symmetric center-padding to a given size."""
    x = _load_csv(path_x)
    padded = librosa.util.pad_center(data=x, size=size, axis=axis)
    return _save_csv(padded, f"{_basename(path_x)}_padded")


@mcp.tool()
def util_normalize(path_x: str, norm: float = 2.0, axis: int = 0) -> str:
    """Norm-normalize an array (L1/L2/Linf via norm=1/2/np.inf — pass numeric)."""
    x = _load_csv(path_x)
    n = librosa.util.normalize(x, norm=norm, axis=axis)
    return _save_csv(n, f"{_basename(path_x)}_norm")


@mcp.tool()
def util_stack_memory(path_x: str, n_steps: int = 2, delay: int = 1) -> str:
    """Time-delay embedding (stack lagged copies along the row axis)."""
    x = _load_csv(path_x)
    s = librosa.feature.stack_memory(data=x, n_steps=n_steps, delay=delay)
    return _save_csv(s, f"{_basename(path_x)}_stacked")


# ===========================================================================
# NEW: UTILITIES — MATCHING
# ===========================================================================

@mcp.tool()
def util_match_events(path_events_from: str, path_events_to: str) -> str:
    """Match events in `from` to nearest in `to`. Inputs are 1-D CSVs of integer/float frames.
    Returns CSV of the matching index array."""
    a = _load_csv(path_events_from).astype(int)
    b = _load_csv(path_events_to).astype(int)
    matches = librosa.util.match_events(a, b)
    return _save_csv(np.asarray(matches, dtype=float), f"{_basename(path_events_from)}_matched")


@mcp.tool()
def util_match_intervals(path_intervals_from: str, path_intervals_to: str) -> str:
    """Match intervals (N×2 arrays of [start, end] in seconds or frames)."""
    a = _load_csv(path_intervals_from)
    b = _load_csv(path_intervals_to)
    if a.ndim == 1: a = a.reshape(-1, 2)
    if b.ndim == 1: b = b.reshape(-1, 2)
    matches = librosa.util.match_intervals(a, b)
    return _save_csv(np.asarray(matches, dtype=float), f"{_basename(path_intervals_from)}_imatched")


# ===========================================================================
# NEW: UTILITIES — MISC (time/sample/frame conversions)
# ===========================================================================

@mcp.tool()
def util_samples_to_time(path_samples: str, sr: int = 22050) -> str:
    """Convert a 1-D CSV of sample indices into seconds."""
    s = _load_csv(path_samples)
    t = librosa.samples_to_time(s.astype(int), sr=sr)
    return _save_csv(t, f"{_basename(path_samples)}_seconds")


@mcp.tool()
def util_time_to_samples(path_seconds: str, sr: int = 22050) -> str:
    """Convert seconds → sample indices."""
    t = _load_csv(path_seconds)
    s = librosa.time_to_samples(t, sr=sr)
    return _save_csv(np.asarray(s, dtype=float), f"{_basename(path_seconds)}_samples")


@mcp.tool()
def util_frames_to_time(path_frames: str, sr: int = 22050, hop_length: int = 512) -> str:
    """Convert frame indices → seconds."""
    f = _load_csv(path_frames).astype(int)
    t = librosa.frames_to_time(f, sr=sr, hop_length=hop_length)
    return _save_csv(t, f"{_basename(path_frames)}_t")


@mcp.tool()
def util_time_to_frames(path_seconds: str, sr: int = 22050, hop_length: int = 512) -> str:
    """Convert seconds → frame indices."""
    t = _load_csv(path_seconds)
    f = librosa.time_to_frames(t, sr=sr, hop_length=hop_length)
    return _save_csv(np.asarray(f, dtype=float), f"{_basename(path_seconds)}_frames")


# ===========================================================================
# NEW: LAPLACIAN SEGMENTATION (Brian McFee, ISMIR 2014)
# ===========================================================================
# Implements the canonical pipeline:
#   1. CQT chromagram + MFCCs
#   2. Beat-synchronous feature aggregation
#   3. Recurrence matrix + path-enhanced affinity
#   4. Symmetric normalised Laplacian → eigen-decomposition
#   5. K-means on the top-k eigenvectors → segment labels
# Reference: librosa.segment.recurrence_matrix +
#            https://librosa.org/doc/latest/auto_examples/plot_segmentation.html

@mcp.tool()
def recurrence_matrix(
    path_features: str,
    k: Optional[int] = None,
    width: int = 1,
    metric: str = "sqeuclidean",
    sym: bool = True,
) -> str:
    """Compute a librosa recurrence (self-similarity) matrix from a feature CSV."""
    F = _load_csv(path_features)
    R = librosa.segment.recurrence_matrix(F, k=k, width=width, metric=metric, sym=sym, mode="affinity")
    return _save_csv(R, f"{_basename(path_features)}_recurrence")


@mcp.tool()
def laplacian_segmentation(
    path_audio_time_series_y: str,
    sr: int = 22050,
    hop_length: int = 1024,
    n_segments: int = 5,
    bpo: int = 12 * 3,
) -> dict:
    """Full Laplacian-segmentation pipeline. Returns segment boundaries (in seconds)
    and a per-frame label CSV path.

    Heavy operation — for a 3-min track expect 5–15 s of CPU time.
    """
    import scipy.sparse
    from sklearn.cluster import KMeans

    y = _load_csv(path_audio_time_series_y)

    # 1. Features: chroma (CQT) + MFCC
    C = librosa.amplitude_to_db(
        np.abs(librosa.cqt(y=y, sr=sr, hop_length=hop_length, bins_per_octave=bpo)),
        ref=np.max,
    )
    mfcc_feat = librosa.feature.mfcc(y=y, sr=sr, hop_length=hop_length, n_mfcc=13)

    # 2. Beat-synchronous aggregation
    tempo_bpm, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop_length, trim=False)
    Csync = librosa.util.sync(C, beats, aggregate=np.median)
    Msync = librosa.util.sync(mfcc_feat, beats)

    # 3. Recurrence (timbral) + path (sequential) graphs
    R = librosa.segment.recurrence_matrix(
        Csync, width=3, mode="affinity", sym=True,
    )
    df_path = librosa.segment.timelag_filter(scipy.ndimage.median_filter)
    Rf = df_path(R, size=(1, 7))

    # Path graph along the diagonal
    path_distance = np.sum(np.diff(Msync, axis=1) ** 2, axis=0)
    sigma = np.median(path_distance)
    path_sim = np.exp(-path_distance / sigma)
    R_path = np.diag(path_sim, k=1) + np.diag(path_sim, k=-1)

    # 4. Combine + Laplacian
    deg_path = np.sum(R_path, axis=1)
    deg_rec = np.sum(Rf, axis=1)
    mu = deg_path.dot(deg_path + deg_rec) / np.sum((deg_path + deg_rec) ** 2)
    A = mu * Rf + (1 - mu) * R_path

    L = scipy.sparse.csgraph.laplacian(A, normed=True)
    evals, evecs = scipy.linalg.eigh(L)
    evecs = librosa.util.normalize(evecs, axis=1)

    # 5. K-means on top-k eigenvectors
    X = evecs[:, :n_segments]
    seg_ids = KMeans(n_clusters=n_segments, n_init=10, random_state=0).fit_predict(X)

    # Convert beat-indexed labels back to frame boundaries
    bound_beats = 1 + np.flatnonzero(seg_ids[:-1] != seg_ids[1:])
    bound_beats = librosa.util.fix_frames(bound_beats, x_min=0, x_max=len(seg_ids))
    bound_frames = beats[bound_beats]
    bound_frames = librosa.util.fix_frames(bound_frames, x_min=0)
    bound_times = librosa.frames_to_time(bound_frames, sr=sr, hop_length=hop_length)

    labels_path = _save_csv(
        np.asarray(seg_ids, dtype=float),
        _basename(path_audio_time_series_y) + "_lapseg_labels",
    )

    return {
        "tempo": float(tempo_bpm),
        "n_beats": int(len(beats)),
        "boundary_times_seconds": bound_times.tolist(),
        "segment_labels_path": labels_path,
        "n_segments": int(n_segments),
    }


# ===========================================================================
# PROMPT (kept for parity with upstream)
# ===========================================================================

@mcp.prompt()
def analyze_audio() -> str:
    return (
        "Lovable's extended Music Analysis MCP. Beyond upstream tools (load, "
        "tempo, mfcc, chroma_cqt, beat_track, get_duration, download_from_url, "
        "download_from_youtube) you also have:\n"
        "  Sequential modeling: dtw, viterbi, viterbi_discriminative\n"
        "  Array utils:         util_frame, util_pad_center, util_normalize, util_stack_memory\n"
        "  Matching utils:      util_match_events, util_match_intervals\n"
        "  Misc utils:          util_samples_to_time, util_time_to_samples, "
        "util_frames_to_time, util_time_to_frames\n"
        "  Laplacian seg:       recurrence_matrix, laplacian_segmentation\n"
    )


if __name__ == "__main__":
    mcp.run()

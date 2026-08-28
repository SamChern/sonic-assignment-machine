"""Row -> ontology tag normalization for the Intuizi ingest worker.

This is a faithful port of `supabase/functions/_shared/intuizi.ts::normalizeRow`.
The mapping MUST stay in sync with that file: the tag codes it produces are the
`taxonomy_nodes.code` values the ontology, the calibration priors and the kNN
warm start are all keyed on. Changing a code here silently forks the taxonomy.

Only the normalization moved to EC2 — scoring still happens in the
`intuizi-score-worker` edge function, exactly as before.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

REPORT_TYPES = ("ctv", "apps", "visitation", "demographics", "origin")

_PATH_STOP = {
    "www", "index", "html", "htm", "php", "amp", "en", "en-us", "us", "news",
    "article", "articles", "story", "stories", "page", "pages", "p", "id",
}

_IDENTIFIER_KEYS = (
    "primary_identifier", "primaryidentifier", "eid", "maid", "madid", "maid_id",
    "idfa", "aaid", "gaid", "hem", "device_id", "email1", "hashed_email", "email",
)


def slug(value: Any) -> str:
    """Lowercase, dash-separated token — must match the TS `slug()` exactly."""
    s = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower())
    return s.strip("-")[:80]


def pick(row: Dict[str, Any], *keys: str) -> str:
    """First non-empty value among `keys`, case-insensitive on the column name."""
    lowered = {str(k).lower(): v for k, v in row.items()}
    for key in keys:
        v = lowered.get(key.lower())
        if v is None:
            continue
        s = str(v).strip()
        if s and s.lower() not in ("nan", "none", "null"):
            return s
    return ""


def multi(value: str) -> List[str]:
    """Split a delimited multi-value cell (IAB lists, segment codes)."""
    if not value:
        return []
    parts = re.split(r"[|,;]", value)
    return [p.strip() for p in parts if p.strip()][:12]


def path_topics(page: str) -> List[str]:
    if not page:
        return []
    path = re.sub(r"^https?://[^/]+", "", page, flags=re.I).split("?")[0].split("#")[0]
    out: List[str] = []
    for raw in path.split("/"):
        seg = raw.strip().lower()
        if not seg or len(seg) < 3 or seg.isdigit() or seg in _PATH_STOP:
            continue
        trimmed = "-".join(re.sub(r"\.(html?|php|aspx)$", "", seg).split("-")[:4])
        if len(trimmed) >= 3 and trimmed not in out:
            out.append(trimmed)
        if len(out) == 2:
            break
    return out


def host_of(ref: str) -> str:
    if not ref:
        return ""
    m = re.match(r"^(?:https?://)?([^/?#\s]+)", ref, flags=re.I)
    return re.sub(r"^www\.", "", m.group(1), flags=re.I).lower() if m else ""


def daypart(value: str) -> str:
    if not value:
        return ""
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(value.replace("Z", "+0000"), fmt)
            break
        except ValueError:
            dt = None
    else:
        dt = None
    if dt is None:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return ""
    h = dt.astimezone(timezone.utc).hour if dt.tzinfo else dt.hour
    if h < 6:
        return "overnight"
    if h < 12:
        return "morning"
    if h < 17:
        return "afternoon"
    if h < 22:
        return "primetime"
    return "latenight"


def identifier_of(row: Dict[str, Any]) -> str:
    """The join key. Never a feature."""
    return pick(row, *_IDENTIFIER_KEYS)


def _intensity_confidence(raw: str) -> Optional[float]:
    try:
        n = float(raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(n) or n <= 0:
        return None
    return min(1.0, 0.5 + math.log10(1 + n) / 4)


def normalize_row(report_type: str, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One delivery row -> one scoring task, or None when it carries no taxonomy."""
    identifier = identifier_of(row)
    if not identifier:
        return None

    tags: List[Dict[str, Any]] = []
    signals: Dict[str, Any] = {}
    confidence = 0.7
    label = ""

    def tag(code: str, label_text: str, parent: str) -> None:
        tags.append({"code": code, "label": label_text, "parent_code": parent, "weight": 1})

    if report_type == "ctv":
        genre = pick(row, "contentgenre", "content_genre", "genre")
        ctype = pick(row, "contenttype", "content_type")
        channel = pick(row, "channelname", "channel_name", "network", "domain", "site")
        iab = multi(pick(row, "iab_cats", "iab_categories", "iabcats", "iab_codes", "iabcodes"))
        if genre:
            tag(f"ctv.genre.{slug(genre)}", f"CTV genre: {genre}", "ctv.genre")
        if ctype:
            tag(f"ctv.type.{slug(ctype)}", f"CTV content type: {ctype}", "ctv.type")
        if channel:
            tag(f"ctv.channel.{slug(channel)}", f"CTV channel: {channel}", "ctv.channel")
        for c in iab:
            tag(f"iab.{slug(c)}", f"IAB category {c}", "iab")

        page = pick(row, "page", "path", "url")
        topics = path_topics(page)
        for t in topics:
            tag(f"web.topic.{slug(t)}", f"Web topic: {t}", "web.topic")
        ref_host = host_of(pick(row, "ref", "referrer", "referer"))
        if ref_host:
            tag(f"web.referrer.{slug(ref_host)}", f"Referrer: {ref_host}", "web.referrer")

        raw_signals = pick(row, "signals", "signal_count", "impressions")
        boosted = _intensity_confidence(raw_signals)
        if boosted is not None:
            confidence = boosted

        signals.update({
            "contentgenre": genre,
            "contenttype": ctype,
            "channelname": channel,
            "iab_cats": iab,
            "web_topics": topics,
            "referrer_host": ref_host or None,
            "signals": float(raw_signals) if boosted is not None else None,
            "meta": {
                "device_id": pick(row, "ctv_taxonomy", "device_id", "deviceid"),
                "useragent": pick(row, "useragent", "user_agent"),
                "page": page,
            },
        })
        label = " · ".join([p for p in (channel, genre, ctype, topics[0] if topics else "") if p]) or "CTV impression"

    elif report_type == "apps":
        category = pick(row, "CategoryName", "category_name", "category")
        taxonomy = pick(row, "TaxonomyName", "taxonomy_name", "taxonomy")
        raw_signals = pick(row, "Signals", "signals", "signal_count")
        if category:
            tag(f"app.category.{slug(category)}", f"App category: {category}", "app.category")
        if taxonomy:
            tag(f"app.taxonomy.{slug(taxonomy)}", f"App taxonomy: {taxonomy}", "app.taxonomy")
        boosted = _intensity_confidence(raw_signals)
        if boosted is not None:
            confidence = boosted
        signals.update({
            "CategoryName": category,
            "TaxonomyName": taxonomy,
            "Signals": float(raw_signals) if boosted is not None else None,
            "meta": {
                "bundle_id": pick(row, "bundle_id", "bundleid", "app_id"),
                "platform": pick(row, "platform", "os"),
            },
        })
        label = " · ".join([p for p in (category, taxonomy) if p]) or "App affinity"

    elif report_type == "visitation":
        brand = pick(row, "brandName", "brand_name", "brand")
        ts = pick(row, "d_utc", "timestamp", "visit_time")
        dp = daypart(ts)
        if brand:
            tag(f"visit.brand.{slug(brand)}", f"Visited brand: {brand}", "visit.brand")
        if dp:
            tag(f"visit.daypart.{dp}", f"Visit daypart: {dp}", "visit.daypart")
        distance: Optional[float] = None
        try:
            distance = float(pick(row, "distance", "dist_m"))
        except (TypeError, ValueError):
            distance = None
        if distance is not None and math.isfinite(distance):
            confidence = 0.9 if distance <= 25 else 0.7 if distance <= 100 else 0.5 if distance <= 250 else 0.35
        signals.update({
            "brandName": brand,
            "visited_at": ts,
            "daypart": dp,
            "distance": distance,
            "meta": {"poi_id": pick(row, "poi_id", "poiid", "location_id")},
        })
        label = " · ".join([p for p in (brand, dp) if p]) or "Visitation"

    elif report_type == "demographics":
        age = pick(row, "age_range", "agerange", "age_band", "age")
        income = pick(row, "income_range", "income_band", "income")
        household = pick(row, "household_composition", "household", "family_status", "marital_status")
        if age:
            tag(f"demo.age.{slug(age)}", f"Age band: {age}", "demo.age")
        if income:
            tag(f"demo.income.{slug(income)}", f"Income band: {income}", "demo.income")
        if household:
            tag(f"demo.household.{slug(household)}", f"Household: {household}", "demo.household")
        signals.update({
            "age_band": age,
            "income_band": income,
            "household": household,
            "meta": {"segment_codes": multi(pick(row, "segment_codes", "segments"))},
        })
        label = " · ".join([p for p in (age, income) if p]) or "Demographics"

    else:  # origin
        geo_class = pick(row, "origin_type", "location_type", "place_type", "type")
        region = pick(row, "state", "region", "dma", "metro", "city")
        travel = pick(row, "travel_type", "travel", "distance_band")
        if geo_class:
            tag(f"origin.class.{slug(geo_class)}", f"Origin class: {geo_class}", "origin.class")
        if region:
            tag(f"origin.region.{slug(region)}", f"Origin region: {region}", "origin.region")
        if travel:
            tag(f"origin.travel.{slug(travel)}", f"Travel context: {travel}", "origin.travel")
        signals.update({
            "origin_class": geo_class,
            "region": region,
            "travel": travel,
            "meta": {"country": pick(row, "country"), "provider": pick(row, "provider")},
        })
        label = " · ".join([p for p in (region, geo_class) if p]) or "Origin"

    if not tags:
        # Roster-only row: a join key with no taxonomy content. Nothing to score.
        return None

    return {
        "identifier": identifier,
        "label": label,
        "tags": tags,
        "signals": [signals],
        "confidence": round(confidence, 3),
    }


def merge_by_identifier(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Fold many rows per identifier into one scoring task.

    The queue is unique on (object_key, identifier), so collapsing here keeps the
    callback batch small and makes the tag set complete on the first write.
    """
    merged: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        key = row["identifier"]
        cur = merged.get(key)
        if cur is None:
            merged[key] = dict(row)
            continue
        seen = {t["code"] for t in cur["tags"]}
        for t in row["tags"]:
            if t["code"] not in seen and len(cur["tags"]) < 64:
                cur["tags"].append(t)
                seen.add(t["code"])
        if len(cur["signals"]) < 200:
            cur["signals"].extend(row["signals"])
        cur["confidence"] = max(cur["confidence"], row["confidence"])
        if not cur["label"]:
            cur["label"] = row["label"]
    return list(merged.values())

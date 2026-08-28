"""IAB Content Taxonomy v1.0 human-readable labels.

Python mirror of `supabase/functions/_shared/iabLabels.ts`. Intuizi feeds send
bare codes ("IAB9-30"); labelling them "IAB category IAB9-30" leaves taxonomy
nodes with no semantic content, which makes their CLAP text embeddings — and
therefore every AudioSet crosswalk proposal — useless. Keep in sync with the
TypeScript copy.
"""

import re

IAB_TIER1 = {
    "IAB1": "Arts & Entertainment",
    "IAB2": "Automotive",
    "IAB3": "Business",
    "IAB4": "Careers",
    "IAB5": "Education",
    "IAB6": "Family & Parenting",
    "IAB7": "Health & Fitness",
    "IAB8": "Food & Drink",
    "IAB9": "Hobbies & Interests",
    "IAB10": "Home & Garden",
    "IAB11": "Law, Government & Politics",
    "IAB12": "News",
    "IAB13": "Personal Finance",
    "IAB14": "Society",
    "IAB15": "Science",
    "IAB16": "Pets",
    "IAB17": "Sports",
    "IAB18": "Style & Fashion",
    "IAB19": "Technology & Computing",
    "IAB20": "Travel",
    "IAB21": "Real Estate",
    "IAB22": "Shopping",
    "IAB23": "Religion & Spirituality",
    "IAB24": "Uncategorized",
    "IAB25": "Non-Standard Content",
    "IAB26": "Illegal Content",
}

IAB_TIER2 = {
    "IAB1-1": "Books & Literature",
    "IAB1-2": "Celebrity Fan & Gossip",
    "IAB1-3": "Fine Art",
    "IAB1-4": "Humor",
    "IAB1-5": "Movies",
    "IAB1-6": "Music",
    "IAB1-7": "Television",
    "IAB2-10": "Electric Vehicle",
    "IAB8-7": "Cuisine-Specific",
    "IAB8-8": "Desserts & Baking",
    "IAB9-2": "Arts & Crafts",
    "IAB9-30": "Video & Computer Games",
    "IAB10-9": "Remodeling & Construction",
    "IAB11-2": "Legal Issues",
    "IAB11-4": "Politics",
    "IAB12-1": "International News",
    "IAB12-2": "National News",
    "IAB12-3": "Local News",
    "IAB15-10": "Weather",
    "IAB19-6": "Cell Phones",
    "IAB19-15": "Email",
}


def normalize_iab_code(raw: str) -> str:
    compact = re.sub(r"[^A-Z0-9-]", "", str(raw or "").upper())
    # "IAB-7" hyphen is feed noise, not a tier-2 split.
    return re.sub(r"^IAB-(\d)", r"IAB\1", compact)


def iab_label(raw: str) -> str:
    code = normalize_iab_code(raw)
    m = re.match(r"^IAB\d+", code)
    tier1 = IAB_TIER1.get(m.group(0)) if m else None
    if not tier1:
        return f"IAB category {raw}"
    leaf = IAB_TIER2.get(code) or IAB_TIER2.get("-".join(code.split("-")[:2]))
    return f"{code} - {tier1}: {leaf}" if leaf else f"{code} - {tier1}"

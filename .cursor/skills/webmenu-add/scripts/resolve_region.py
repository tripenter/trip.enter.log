#!/usr/bin/env python3
"""Resolve free-text region input to a GeoJSON 시·군·구 canonical name.

Reads web/data/korea-sig.geojson (map-registerable districts).
Prints one JSON object to stdout for the webmenu-add skill.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path


REGION_BY_PREFIX = {
    "11": ("metro", "서울"),
    "21": ("metro", "부산"),
    "22": ("metro", "대구"),
    "23": ("metro", "인천"),
    "24": ("metro", "광주"),
    "25": ("metro", "대전"),
    "26": ("metro", "울산"),
    "29": ("metro", "세종"),
    "31": ("province", "경기도"),
    "32": ("province", "강원도"),
    "33": ("province", "충청북도"),
    "34": ("province", "충청남도"),
    "35": ("province", "전라북도"),
    "36": ("province", "전라남도"),
    "37": ("province", "경상북도"),
    "38": ("province", "경상남도"),
    "39": ("province", "제주도"),
}

FOLDER_REGIONS = {
    "seoul": ["11"],
    "busan": ["21"],
    "daegu": ["22"],
    "incheon": ["23"],
    "gwangju": ["24"],
    "daejeon": ["25"],
    "ulsan": ["26"],
    "sejong": ["29"],
    "gyeonggi": ["31"],
    "gangwon": ["32"],
    "chungbuk": ["33"],
    "chungnam": ["34"],
    "chungcheong": ["33", "34"],
    "jeonbuk": ["35"],
    "jeonnam": ["36"],
    "jeolla": ["35", "36"],
    "gyeongbuk": ["37"],
    "gyeongnam": ["38"],
    "gyeongsang": ["37", "38"],
    "jeju": ["39"],
}

SUFFIXES = ("특별자치시", "특별시", "광역시", "시", "군", "구")


def workspace_root() -> Path:
    # .cursor/skills/webmenu-add/scripts/resolve_region.py -> workspace root
    return Path(__file__).resolve().parents[4]


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = re.sub(r"\s+", "", text)
    return text.strip().lower()


def strip_suffix(name: str) -> str:
    for suffix in SUFFIXES:
        if name.endswith(suffix) and len(name) > len(suffix):
            return name[: -len(suffix)]
    return name


def display_label(name: str, code: str) -> str:
    prefix = str(code or "")[:2]
    meta = REGION_BY_PREFIX.get(prefix)
    compound = re.match(r"^(.+시)(.+구)$", name)
    formatted = f"{compound.group(1)} {compound.group(2)}" if compound else name
    if not meta:
        return formatted
    kind, label = meta
    if compound:
        return formatted
    if kind == "metro":
        if name in ("세종시", "세종"):
            return "세종"
        return f"{label} {formatted}"
    return f"{label} {formatted}"


def aliases_for(name: str) -> list[str]:
    aliases = {name, normalize(name)}
    compound = re.match(r"^(.+시)(.+구)$", name)
    if compound:
        city, gu = compound.group(1), compound.group(2)
        aliases.update(
            {
                city,
                gu,
                strip_suffix(city),
                strip_suffix(gu),
                normalize(city),
                normalize(gu),
                normalize(strip_suffix(city)),
                normalize(strip_suffix(gu)),
            }
        )
        return sorted(a for a in aliases if a)
    stem = strip_suffix(name)
    aliases.update({stem, normalize(stem)})
    return sorted(a for a in aliases if a)


def load_districts(geo_path: Path) -> list[dict]:
    data = json.loads(geo_path.read_text(encoding="utf-8"))
    districts: list[dict] = []
    for feature in data.get("features") or []:
        props = feature.get("properties") or {}
        name = props.get("name")
        code = str(props.get("code") or "")
        if not name or not code:
            continue
        districts.append(
            {
                "name": name,
                "code": code,
                "prefix": code[:2],
                "label": display_label(name, code),
                "aliases": aliases_for(name),
                "stem": normalize(strip_suffix(name)),
            }
        )
    return districts


def prefixes_from_folder(folder: str | None) -> set[str]:
    if not folder:
        return set()
    scope: set[str] = set()
    for segment in str(folder).strip("/").split("/"):
        for prefix in FOLDER_REGIONS.get(segment, []):
            scope.add(prefix)
    return scope


def score_similarity(query: str, district: dict) -> float:
    q = normalize(query)
    if not q:
        return 0.0
    best = 0.0
    for alias in district["aliases"]:
        a = normalize(alias)
        if not a:
            continue
        if q == a:
            return 1.0
        if q in a or a in q:
            best = max(best, 0.92)
        best = max(best, SequenceMatcher(None, q, a).ratio())
        best = max(best, SequenceMatcher(None, q, district["stem"]).ratio())
    # typo-friendly: compare against stem with common endings attempted
    for suffix in ("시", "군", "구"):
        best = max(
            best,
            SequenceMatcher(None, q, normalize(strip_suffix(district["name"]) + suffix)).ratio(),
        )
    return best


def resolve(query: str, districts: list[dict], *, limit: int = 12) -> dict:
    raw = (query or "").strip()
    if not raw:
        return {"status": "empty", "input": raw, "region": None, "candidates": []}

    q_norm = normalize(raw)
    q_stem = normalize(strip_suffix(raw))

    exact: list[dict] = []
    for d in districts:
        names = {normalize(d["name"]), d["stem"]}
        names.update(normalize(a) for a in d["aliases"])
        if q_norm in names or q_stem in names:
            # Prefer canonical equality / stem+suffix matches for "영월" → 영월군
            if normalize(d["name"]) == q_norm or d["stem"] == q_stem or d["stem"] == q_norm:
                exact.append(d)

    # Deduplicate by name+code
    uniq: dict[tuple[str, str], dict] = {}
    for d in exact:
        uniq[(d["name"], d["code"])] = d
    exact_list = list(uniq.values())

    if len(exact_list) == 1:
        d = exact_list[0]
        return {
            "status": "matched",
            "input": raw,
            "region": d["name"],
            "candidates": [
                {
                    "index": 1,
                    "name": d["name"],
                    "code": d["code"],
                    "label": d["label"],
                    "score": 1.0,
                }
            ],
        }

    if len(exact_list) > 1:
        candidates = [
            {
                "index": i + 1,
                "name": d["name"],
                "code": d["code"],
                "label": d["label"],
                "score": 1.0,
            }
            for i, d in enumerate(exact_list)
        ]
        return {
            "status": "choose",
            "input": raw,
            "region": None,
            "reason": "동명 시·군·구가 여러 개입니다. 번호를 선택하세요.",
            "candidates": candidates,
        }

    # Fuzzy / similar suggestions (single-char typos like 열월≈영월 ~0.5)
    scored: list[tuple[float, dict]] = []
    for d in districts:
        score = score_similarity(raw, d)
        if score >= 0.48:
            scored.append((score, d))
    scored.sort(key=lambda item: (-item[0], item[1]["label"]))

    # Also try auto-suffix completion: 영월 → 영월시/군/구 unique hit
    suffix_hits: list[dict] = []
    for suffix in ("시", "군", "구"):
        candidate_name = strip_suffix(raw) + suffix
        for d in districts:
            if d["name"] == candidate_name or normalize(d["name"]) == normalize(candidate_name):
                suffix_hits.append(d)
    suffix_uniq = {(d["name"], d["code"]): d for d in suffix_hits}
    if len(suffix_uniq) == 1:
        d = next(iter(suffix_uniq.values()))
        return {
            "status": "matched",
            "input": raw,
            "region": d["name"],
            "candidates": [
                {
                    "index": 1,
                    "name": d["name"],
                    "code": d["code"],
                    "label": d["label"],
                    "score": 0.99,
                }
            ],
        }
    if len(suffix_uniq) > 1:
        candidates = [
            {
                "index": i + 1,
                "name": d["name"],
                "code": d["code"],
                "label": d["label"],
                "score": 0.99,
            }
            for i, d in enumerate(suffix_uniq.values())
        ]
        return {
            "status": "choose",
            "input": raw,
            "region": None,
            "reason": "시·군·구 접미어를 붙이면 후보가 여러 개입니다. 번호를 선택하세요.",
            "candidates": candidates,
        }

    top = scored[:limit]
    if not top:
        return {
            "status": "choose",
            "input": raw,
            "region": None,
            "reason": "지도에 등록 가능한 유사 시·군·구를 찾지 못했습니다. 다시 입력하거나 지역을 비우세요.",
            "candidates": [],
        }

    # Strong unique fuzzy hit can auto-resolve; weaker hits need user choice.
    strong_unique = top[0][0] >= 0.85 and (
        len(top) == 1 or top[0][0] - top[1][0] >= 0.08
    )
    if strong_unique:
        d = top[0][1]
        return {
            "status": "matched",
            "input": raw,
            "region": d["name"],
            "candidates": [
                {
                    "index": 1,
                    "name": d["name"],
                    "code": d["code"],
                    "label": d["label"],
                    "score": round(top[0][0], 3),
                }
            ],
        }

    candidates = [
        {
            "index": i + 1,
            "name": d["name"],
            "code": d["code"],
            "label": d["label"],
            "score": round(score, 3),
        }
        for i, (score, d) in enumerate(top)
    ]
    return {
        "status": "choose",
        "input": raw,
        "region": None,
        "reason": "정확한 시·군·구명이 아닙니다. 아래 유사 목록에서 번호를 선택하세요.",
        "candidates": candidates,
    }


def filter_scope(districts: list[dict], folder: str | None) -> list[dict]:
    scope = prefixes_from_folder(folder)
    if not scope:
        return districts
    return [d for d in districts if d["prefix"] in scope]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Resolve region text to korea-sig.geojson 시·군·구 name"
    )
    parser.add_argument("--query", required=True, help="User-entered region text")
    parser.add_argument(
        "--folder",
        default=None,
        help="Optional WM_Folder / parent folder to narrow province scope (e.g. gangwon)",
    )
    parser.add_argument(
        "--geojson",
        default=str(workspace_root() / "web" / "data" / "korea-sig.geojson"),
        help="Path to korea-sig.geojson",
    )
    parser.add_argument("--limit", type=int, default=12, help="Max similar candidates")
    args = parser.parse_args()

    geo_path = Path(args.geojson)
    if not geo_path.is_file():
        print(
            json.dumps(
                {
                    "status": "error",
                    "input": args.query,
                    "region": None,
                    "reason": f"GeoJSON 없음: {geo_path}",
                    "candidates": [],
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 2

    districts = load_districts(geo_path)
    scoped = filter_scope(districts, args.folder)
    # If folder scope yields nothing useful for fuzzy, fall back to all
    pool = scoped if scoped else districts
    result = resolve(args.query, pool, limit=max(1, args.limit))

    # If scoped choose/empty with no candidates, retry nationwide
    if (
        args.folder
        and scoped
        and result.get("status") == "choose"
        and not result.get("candidates")
    ):
        result = resolve(args.query, districts, limit=max(1, args.limit))
        result["scoped_folder"] = args.folder
        result["scope_fallback"] = "nationwide"

    if args.folder:
        result.setdefault("scoped_folder", args.folder)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

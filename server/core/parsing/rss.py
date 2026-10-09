from __future__ import annotations

# noinspection PyPep8Naming — `ET` is the universal stdlib idiom
import re
import xml.etree.ElementTree as ET

from ..http_client import fetch
from ..text import clean

# Feed item tags, compared without the XML namespace prefix.
_ITEM_TAGS = {"item", "entry"}
_DATE_TAGS = {"pubdate", "published", "updated", "date"}
_BULGARIA_TERMS = re.compile(r"\b(bulgaria|sofia|plovdiv|varna|burgas)\b", re.I)
_BALKAN_TERMS = re.compile(
    r"\b(balkans?|serbia|romania|greece|albania|kosovo|montenegro|"
    r"north macedonia|bosnia|croatia|slovenia|moldova)\b",
    re.I,
)
_EUROPE_TERMS = re.compile(
    r"\b(europe|european union|brussels|germany|france|italy|spain|"
    r"uk|britain|poland|sweden|norway|finland)\b",
    re.I,
)
_HEADLINE_CATEGORIES = (
    ("LIFESTYLE", re.compile(r"\b(dating|relationship|marriage|wedding|family|parenting|fashion|beauty|food|recipe|travel|horoscope)\b", re.I)),
    ("HEALTH", re.compile(r"\b(health|hospital|patient|doctor|disease|virus|vaccine|medical|medicine|mental health)\b", re.I)),
    ("SPORTS", re.compile(r"\b(sport|football|soccer|tennis|basketball|olympic|championship|match|league)\b", re.I)),
    ("TECH", re.compile(r"\b(technology|tech|artificial intelligence|\bAI\b|software|cyber|chip| smartphone|social media)\b", re.I)),
    ("CLIMATE", re.compile(r"\b(climate|global warming|emissions|renewable|wildfire|heatwave|flood|drought)\b", re.I)),
    ("SCIENCE", re.compile(r"\b(science|scientist|research|study|space|NASA|discovery|experiment)\b", re.I)),
    ("CONFLICT", re.compile(r"\b(war|conflict|airstrike|missile|troops|military|ceasefire|invasion|shelling|battle)\b", re.I)),
    ("POLITICS", re.compile(r"\b(election|president|prime minister|parliament|government|congress|campaign|political|minister)\b", re.I)),
    ("MARKETS", re.compile(r"\b(stock market|shares|stocks|investor|investing|bond yields|forex|commodity prices|wall street|Nasdaq|S&P 500)\b", re.I)),
    ("BUSINESS", re.compile(r"\b(company|companies|business|CEO|earnings|salary|layoffs|workplace|jobs|employment|trade deal)\b", re.I)),
)


def _headline_category(title: str, fallback: str) -> str:
    """Prefer clear headline subject over a broad publisher feed label."""
    for category, pattern in _HEADLINE_CATEGORIES:
        if pattern.search(title):
            return category
    return fallback


def _tag_name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1].lower()


def local_text(element: ET.Element, names: set[str]) -> str:
    for child in element:
        if _tag_name(child) in names and child.text:
            return clean(child.text)
    return ""


def _item_link(item: ET.Element) -> str:
    """Extract the item link, handling both RSS ``<link>text`` and the Atom
    ``<link href=...>`` shape (preferring ``rel="alternate"``)."""
    link = local_text(item, {"link"})
    if link:
        return link
    for child in item:
        if _tag_name(child) == "link":
            link = child.attrib.get("href", "")
            if child.attrib.get("rel", "alternate") == "alternate":
                break
    return link


def rss_items(
    url: str,
    source_override: str | None = None,
    category: str = "WORLD",
    region: str = "GLOBAL",
    language: str = "",
    country: str = "",
) -> list[dict]:
    """Parse a feed URL into normalised headline rows.

    Rows are capped at 60 per feed to keep one chatty publisher from
    dominating the merged timeline. Items missing a title or link are
    skipped rather than emitted half-formed (fail soft per row, fail loud
    per feed — parse errors propagate to the caller).
    """
    body = fetch(
        url, "application/rss+xml, application/atom+xml, application/xml, text/xml"
    )
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        clean_xml = re.sub(
            r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", body.decode("utf-8", "replace")
        )
        root = ET.fromstring(clean_xml)
    items = [item for item in root.iter() if _tag_name(item) in _ITEM_TAGS]

    rows: list[dict] = []
    for item in items[:60]:
        title = local_text(item, {"title"})
        link = _item_link(item)
        if not (title and link):
            continue
        item_region = region
        if region == "GLOBAL":
            if _BULGARIA_TERMS.search(title):
                item_region = "BULGARIA"
            elif _BALKAN_TERMS.search(title):
                item_region = "BALKANS"
            elif _EUROPE_TERMS.search(title):
                item_region = "EUROPE"
        rows.append(
            {
                "title": title,
                "url": link,
                "published": local_text(item, _DATE_TAGS),
                "source": source_override or "NEWSWIRE",
                "category": _headline_category(title, category),
                "region": item_region,
                "language": language,
                "country": country,
                "timeType": "PUBLISHED",
            }
        )
    return rows

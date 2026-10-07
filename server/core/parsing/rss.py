"""RSS / Atom feed parsing.

Only the standard library parser is used; feeds are fetched exclusively from
the fixed endpoints listed in :mod:`server.services.news_feeds`.
"""

from __future__ import annotations

# noinspection PyPep8Naming — `ET` is the universal stdlib idiom
import xml.etree.ElementTree as ET

from ..http_client import fetch
from ..text import clean

# Feed item tags, compared without the XML namespace prefix.
_ITEM_TAGS = {"item", "entry"}
_DATE_TAGS = {"pubdate", "published", "updated", "date"}


def _tag_name(element: ET.Element) -> str:
    """Return an element's tag without its ``{namespace}`` prefix."""
    return element.tag.rsplit("}", 1)[-1].lower()


def local_text(element: ET.Element, names: set[str]) -> str:
    """Return the cleaned text of the first direct child matching ``names``."""
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
        import re

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
        rows.append(
            {
                "title": title,
                "url": link,
                "published": local_text(item, _DATE_TAGS),
                "source": local_text(item, {"source"}) or source_override or "NEWSWIRE",
                "category": category,
                "region": region,
                "language": language,
                "country": country,
                "timeType": "PUBLISHED",
            }
        )
    return rows

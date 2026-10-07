"""HTML listing extraction for the Bazar.bg public marketplace index.

The site has no API, so a forgiving ``HTMLParser`` subclass pulls listing
links and splits the visible text into title / location / posted / price
fields. Bulgarian date words ("днес", "вчера", month names) are part of the
grammar — keep them intact.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from urllib.parse import urlparse

from ..text import clean

_PRICE_RE = re.compile(
    r"(?:^|\s)(\d[\d\s.,]*\s?(?:€|лв\.?|BGN|EUR)|Договаряне)\s*$", re.I
)
_POSTED_RE = re.compile(
    r"\b(днес|вчера|преди\s+\d+\s+(?:минути?|часа?|дни?|седмици?|месеца?)"
    r"|\d{1,2}\s+(?:януари|февруари|март|април|май|юни|юли|август"
    r"|септември|октомври|ноември|декември))\b",
    re.I,
)
_LOCATION_RE = re.compile(r"\s((?:гр\.|с\.|к\.к\.|обл\.)\s*.+)$", re.I)


class ListingParser(HTMLParser):
    """Collect ``/obiava-`` links and their visible text into structured rows."""

    def __init__(self) -> None:
        super().__init__()
        self.current: dict | None = None
        self.rows: list[dict] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = dict(attrs).get("href") or ""
        path = urlparse(href).path
        if path.startswith("/obiava-"):
            self.current = {
                "url": href if href.startswith("http") else "https://bazar.bg" + path,
                "parts": [],
            }

    def handle_data(self, data: str) -> None:
        if self.current is not None:
            self.current["parts"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or self.current is None:
            return
        raw = clean(" ".join(self.current["parts"]))
        row = self._split_fields(raw)
        if row is not None:
            row["url"] = self.current["url"]
            row["source"] = "BAZAR.BG"
            self.rows.append(row)
        self.current = None

    @staticmethod
    def _split_fields(raw: str) -> dict | None:
        """Peel price, posted date and location off the tail of the text.

        Returns ``None`` for fragments whose remaining title is too short to
        be a real listing heading.
        """
        price_match = _PRICE_RE.search(raw)
        price = clean(price_match.group(1)) if price_match else ""
        if price_match:
            raw = clean(raw[: price_match.start()])

        date_match = _POSTED_RE.search(raw)
        posted = clean(date_match.group(1)) if date_match else ""
        if date_match:
            raw = clean(raw[: date_match.start()])

        location_match = _LOCATION_RE.search(raw)
        location = clean(location_match.group(1)) if location_match else ""
        title = clean(raw[: location_match.start()]) if location_match else raw

        if len(title) <= 8:
            return None
        return {
            "title": title[:240],
            "location": location[:120],
            "posted": posted,
            "price": price,
        }

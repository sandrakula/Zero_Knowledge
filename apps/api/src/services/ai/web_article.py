"""Web-article extraction for the course-planning flow.

Turns an arbitrary web page into clean, readable text so the planner can
ground chapters/activities on the actual article instead of a bare URL.
``trafilatura`` (a purpose-built readability extractor) runs first; when it
returns nothing, a ``BeautifulSoup`` fallback strips boilerplate and takes the
largest text block.

Any network/parsing failure is logged and swallowed: ``fetch_article`` returns
``""`` and never raises, mirroring the YouTube module so a bad URL can never
abort course planning.
"""

import logging
import re

import httpx
import trafilatura
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

MAX_ARTICLE_CHARS = 20_000
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_STRIP_TAGS = ("script", "style", "nav", "header", "footer", "aside", "form")


def _bs4_fallback(html: str) -> str:
    """Extract readable text when trafilatura returns nothing."""
    try:
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(_STRIP_TAGS):
            tag.decompose()
        for preferred in ("article", "main"):
            node = soup.find(preferred)
            if node is not None:
                text = node.get_text(" ", strip=True)
                if text:
                    return text
        # Largest text block among the leaf-ish containers.
        best = ""
        for tag in soup.find_all(["p", "div", "section"]):
            text = tag.get_text(" ", strip=True)
            if len(text) > len(best):
                best = text
        return best
    except Exception:
        logger.warning("BeautifulSoup article fallback failed", exc_info=True)
        return ""


def fetch_article(url: str, max_chars: int = MAX_ARTICLE_CHARS) -> str:
    """Fetch and extract plain text from a web article ``url``.

    Returns the extracted text capped at ``max_chars``, or ``""`` on ANY
    failure (never raises).
    """
    try:
        response = httpx.get(
            url,
            follow_redirects=True,
            timeout=20.0,
            headers={"User-Agent": _BROWSER_UA},
        )
        response.raise_for_status()
        html = response.text

        text = trafilatura.extract(html)
        if not text:
            text = _bs4_fallback(html)
        if not text:
            return ""

        text = re.sub(r"\s+", " ", text).strip()
        return text[:max_chars]
    except Exception:
        logger.warning("Article fetch failed for %s", url, exc_info=True)
        return ""

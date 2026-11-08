"""Read the «Хроники» Google Form responses sheet as CSV.

The form «Внести решенную задачу в Хроники» stores its responses in a Google
Sheet. That sheet is private by default, so this reader only works once the
sheet is shared ("Anyone with the link — Viewer") or published to the web; we
then fetch Google's CSV export and parse it. No OAuth is needed.

Configure with:
  LEARNHOUSE_INFORMATICS_SHEET_ID  spreadsheet id (the ``/d/<id>/`` part)
  LEARNHOUSE_INFORMATICS_SHEET_GID optional tab gid
"""

from __future__ import annotations

import csv
import io
import logging
import os

import httpx

logger = logging.getLogger(__name__)

SHEET_ID_ENV = "LEARNHOUSE_INFORMATICS_SHEET_ID"
SHEET_GID_ENV = "LEARNHOUSE_INFORMATICS_SHEET_GID"

TIMEOUT = 15.0
_HEADERS = {"User-Agent": "Mozilla/5.0"}


def _sheet_id() -> str | None:
    value = (os.getenv(SHEET_ID_ENV) or "").strip()
    return value or None


def _export_urls(sheet_id: str, gid: str | None) -> list[str]:
    suffix = f"&gid={gid}" if gid else ""
    return [
        f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv{suffix}",
        # Also works for sheets shared via "Publish to web".
        f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv{suffix}",
    ]


def _parse_csv(text: str) -> dict:
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return {"headers": [], "rows": []}
    headers = rows[0]
    data = [row for row in rows[1:] if any(str(cell).strip() for cell in row)]
    return {"headers": headers, "rows": data}


async def fetch_sheet_rows() -> dict:
    """Return the responses table. Never raises.

    Result: ``{"configured": bool, "headers": list, "rows": list, "error": str|None}``.
    """
    sheet_id = _sheet_id()
    if not sheet_id:
        return {
            "configured": False,
            "headers": [],
            "rows": [],
            "error": "sheet_not_configured",
        }

    gid = (os.getenv(SHEET_GID_ENV) or "").strip() or None
    last_status: int | None = None
    try:
        async with httpx.AsyncClient(
            timeout=TIMEOUT, follow_redirects=True, headers=_HEADERS
        ) as client:
            for url in _export_urls(sheet_id, gid):
                try:
                    response = await client.get(url)
                except httpx.HTTPError as exc:
                    logger.warning("informatics sheet fetch failed: %s", exc)
                    continue
                last_status = response.status_code
                if response.status_code != 200:
                    continue
                parsed = _parse_csv(response.text)
                if parsed["headers"] or parsed["rows"]:
                    return {
                        "configured": True,
                        "headers": parsed["headers"],
                        "rows": parsed["rows"],
                        "error": None,
                    }
    except Exception:
        logger.exception("informatics sheet fetch: unexpected error")
        return {
            "configured": True,
            "headers": [],
            "rows": [],
            "error": "unexpected_error",
        }

    return {
        "configured": True,
        "headers": [],
        "rows": [],
        "error": f"http_{last_status}" if last_status else "request_failed",
    }

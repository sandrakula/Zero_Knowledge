"""Google Forms submission service tests (mocked httpx, no network)."""

from urllib.parse import parse_qs

import httpx
import pytest

from src.services.informatics.google_form import (
    FORMRESPONSE_URL,
    VIEWFORM_URL,
    submit_solved_task,
)

FBZX = "7553639224404291602"
VIEWFORM_HTML = (
    "<html><head></head><body>"
    f'<input type="hidden" name="fbzx" value="{FBZX}">'
    "</body></html>"
)


@pytest.mark.asyncio
async def test_submit_posts_expected_url_and_body():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, text=VIEWFORM_HTML)
        return httpx.Response(200, text="<html>thanks</html>")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await submit_solved_task(
        "a@b.com", "TASK_1234", "2026-11-03", client=client
    )

    assert result is True
    assert [(r.method, str(r.url)) for r in requests] == [
        ("GET", VIEWFORM_URL),
        ("POST", FORMRESPONSE_URL),
    ]
    body = parse_qs(requests[-1].content.decode("utf-8"))
    assert body == {
        "emailAddress": ["a@b.com"],
        "entry.8993807": ["TASK_1234"],
        "entry.17394566": ["2026-11-03"],
        "fbzx": [FBZX],
    }


@pytest.mark.asyncio
async def test_submit_returns_false_on_persistent_server_error():
    posts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal posts
        if request.method == "GET":
            return httpx.Response(200, text=VIEWFORM_HTML)
        posts += 1
        return httpx.Response(500, text="error")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await submit_solved_task(
        "a@b.com", "TASK_1234", "2026-11-03", client=client
    )
    assert result is False
    assert posts == 4  # one initial POST plus 3 retries


@pytest.mark.asyncio
async def test_submit_returns_false_on_transport_error():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, text=VIEWFORM_HTML)
        raise httpx.ConnectError("connection refused", request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await submit_solved_task(
        "a@b.com", "TASK_1234", "2026-11-03", client=client
    )
    assert result is False

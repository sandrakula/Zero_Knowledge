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
TAG = "AWjlRz+/0rz9kLpPGSExtmDF0H5XvG3Ofg3WdrjMcG/TTbsvxQ=="
PARTIAL = f'[null,null,&quot;{FBZX}&quot;]'
VIEWFORM_HTML = (
    "<html><head></head><body>"
    '<input type="hidden" name="fvv" value="1">'
    f'<input type="hidden" name="partialResponse" value="{PARTIAL}">'
    '<input type="hidden" name="pageHistory" value="0">'
    f'<input type="hidden" name="tag" value="{TAG}">'
    f'<input type="hidden" name="fbzx" value="{FBZX}">'
    '<input type="hidden" name="submissionTimestamp" value="-1">'
    "</body></html>"
)

EXPECTED_HIDDEN = {
    "fvv": "1",
    "partialResponse": f'[null,null,"{FBZX}"]',
    "pageHistory": "0",
    "tag": TAG,
    "fbzx": FBZX,
    "submissionTimestamp": "-1",
}


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
        **{name: [value] for name, value in EXPECTED_HIDDEN.items()},
        "entry.8993807": ["TASK_1234"],
        "entry.17394566": ["2026-11-03"],
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

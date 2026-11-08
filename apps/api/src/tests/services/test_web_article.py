"""Tests for src/services/ai/web_article.py (web-article extraction)."""

import httpx

import src.services.ai.web_article as wa

ARTICLE_HTML = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Decision Trees Explained</title></head>
<body>
<header><nav>Home About Contact</nav></header>
<article>
  <h1>Decision Trees Explained</h1>
  <p>Decision trees are a popular supervised learning method for classification and regression.</p>
  <p>They recursively partition the feature space into regions by choosing splits that maximize information gain.</p>
  <p>A key advantage is interpretability: the resulting model is a readable set of if-then rules.</p>
  <p>Common pitfalls include overfitting to noise and instability to small data perturbations.</p>
</article>
<footer>Copyright 2026</footer>
</body>
</html>"""


class _FakeResponse:
    def __init__(self, text: str, status_code: int = 200):
        self.text = text
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("GET", "https://example.com")
            raise httpx.HTTPStatusError(
                f"{self.status_code} error", request=request, response=httpx.Response(self.status_code)
            )


def test_fetch_article_extracts_text_from_static_html(monkeypatch):
    monkeypatch.setattr(wa.httpx, "get", lambda *a, **k: _FakeResponse(ARTICLE_HTML))

    text = wa.fetch_article("https://example.com/decision-trees")

    assert "recursively partition the feature space" in text
    assert "information gain" in text


def test_fetch_article_falls_back_to_bs4_when_trafilatura_is_empty(monkeypatch):
    monkeypatch.setattr(wa.httpx, "get", lambda *a, **k: _FakeResponse(ARTICLE_HTML))
    monkeypatch.setattr(wa.trafilatura, "extract", lambda html, *a, **k: None)

    text = wa.fetch_article("https://example.com/decision-trees")

    assert "recursively partition the feature space" in text


def test_fetch_article_strips_boilerplate_in_fallback(monkeypatch):
    monkeypatch.setattr(wa.httpx, "get", lambda *a, **k: _FakeResponse(ARTICLE_HTML))
    monkeypatch.setattr(wa.trafilatura, "extract", lambda html, *a, **k: None)

    text = wa.fetch_article("https://example.com/decision-trees")

    assert "Copyright 2026" not in text
    assert "Home About Contact" not in text


def test_fetch_article_caps_output(monkeypatch):
    monkeypatch.setattr(wa.httpx, "get", lambda *a, **k: _FakeResponse(ARTICLE_HTML))

    text = wa.fetch_article("https://example.com/decision-trees", max_chars=40)

    assert len(text) <= 40


def test_fetch_article_returns_empty_on_network_failure(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(wa.httpx, "get", boom)

    assert wa.fetch_article("https://example.com/offline") == ""


def test_fetch_article_returns_empty_on_http_error(monkeypatch):
    monkeypatch.setattr(wa.httpx, "get", lambda *a, **k: _FakeResponse("not found", 404))

    assert wa.fetch_article("https://example.com/missing") == ""

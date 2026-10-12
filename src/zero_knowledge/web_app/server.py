"""Small standard-library HTTP server for the local/server-hosted PoC."""

from __future__ import annotations

import argparse
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from zero_knowledge.execution import DockerIsolatedExecutionRunner, DockerSandbox
from zero_knowledge.llm import DeepSeekClient
from zero_knowledge.profile import ProfileRoadmapService
from zero_knowledge.solution_review import SolutionReviewService
from zero_knowledge.task_generation import TaskBlockService

from .api import ApiApplication
from .evaluation import StudentSolutionEvaluator
from .service import DiagnosticService

MAX_BODY_BYTES = 256 * 1024


def create_application() -> tuple[ApiApplication, DeepSeekClient]:
    client = DeepSeekClient()
    sandbox = DockerSandbox()
    diagnostics = DiagnosticService(
        TaskBlockService(client, DockerIsolatedExecutionRunner(sandbox)),
        StudentSolutionEvaluator(sandbox),
        SolutionReviewService(client),
        ProfileRoadmapService(client),
    )
    return ApiApplication(diagnostics), client


def make_handler(api: ApiApplication, web_root: Path) -> type[BaseHTTPRequestHandler]:
    root = web_root.resolve()

    class Handler(BaseHTTPRequestHandler):
        server_version = "ZeroKnowledgePoC/1.0"

        def do_GET(self) -> None:
            path = urlsplit(self.path).path
            if path.startswith("/api/"):
                self._send_api(api.handle("GET", path))
                return
            self._send_static(path)

        def do_POST(self) -> None:
            path = urlsplit(self.path).path
            if not path.startswith("/api/"):
                self.send_error(404)
                return
            length = self.headers.get("Content-Length")
            if length is None:
                self._send_json(
                    411,
                    {
                        "error": {
                            "code": "length_required",
                            "message": "Content-Length обязателен.",
                            "retryable": False,
                        }
                    },
                )
                return
            try:
                size = int(length)
            except ValueError:
                self.send_error(400)
                return
            if size > MAX_BODY_BYTES:
                self._send_json(
                    413,
                    {
                        "error": {
                            "code": "body_too_large",
                            "message": "Запрос слишком большой.",
                            "retryable": False,
                        }
                    },
                )
                return
            self._send_api(api.handle("POST", path, self.rfile.read(size)))

        def _send_api(self, response) -> None:
            self._send_json(response.status, response.body)

        def _send_json(self, status: int, body) -> None:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(payload)

        def _send_static(self, request_path: str) -> None:
            relative = (
                "index.html"
                if request_path in ("", "/")
                else unquote(request_path.lstrip("/"))
            )
            candidate = (root / relative).resolve()
            if root not in candidate.parents and candidate != root:
                self.send_error(404)
                return
            if not candidate.is_file():
                self.send_error(404)
                return
            payload = candidate.read_bytes()
            media_type = (
                mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
            )
            self.send_response(200)
            self.send_header(
                "Content-Type",
                f"{media_type}; charset=utf-8"
                if media_type.startswith(("text/", "application/javascript"))
                else media_type,
            )
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
            )
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args) -> None:
            super().log_message(format, *args)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the ZEROK-7 web PoC")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--web-root",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "web",
    )
    args = parser.parse_args()

    api, client = create_application()
    server = ThreadingHTTPServer(
        (args.host, args.port), make_handler(api, args.web_root)
    )
    print(f"ZEROK-7: http://{args.host}:{args.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        client.close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Rebuild a readable chat history from pi session logs.

Reads the JSONL session files that pi stores for this working directory
(``~/.pi/agent/sessions/<slug>/*.jsonl``) and writes one Markdown transcript per
session plus an index into ``docs/chat-history/``.

Usage:
    python scripts/export-chat-history.py [--sessions DIR] [--out DIR]

Defaults to the sessions directory matching the current repo and
``docs/chat-history`` as the output directory.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Keep transcripts readable without losing the conversation.
THINK_LIMIT = 1600
TOOL_ARG_LIMIT = 700
TOOL_RESULT_LIMIT = 600

SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"(?i)(api[_-]?key[\"'\s:=]+)[A-Za-z0-9_\-]{16,}"),
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-]{24,}"),
    # Any KEY/SECRET/TOKEN/PASSWORD assignment in the form KEY=value or KEY: value.
    re.compile(r"(?i)((?:API_?KEY|SECRET|SESSION_SECRET|TOKEN|PASSWORD)\s*[=:]\s*[\"']?)[^\s\"']+"),
    # Free-floating secret-looking values (e.g. "cognos-local-session-secret-1a2b").
    re.compile(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-[Ss]ecret(?:-[A-Za-z0-9]+)+"),
]


def redact(text: str) -> str:
    for pat in SECRET_PATTERNS:
        text = pat.sub(lambda m: (m.group(1) if m.groups() else "") + "<redacted>", text)
    return text


def stringify_content(content) -> str:
    """Flatten a pi message content field into plain text."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    out = []
    for block in content:
        if isinstance(block, str):
            out.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            out.append(block.get("text", ""))
    return "\n".join(out).strip()


def blocks(content):
    if isinstance(content, list):
        return [b for b in content if isinstance(b, dict)]
    return []


def fmt_args(name: str, args) -> str:
    if not isinstance(args, dict):
        return str(args)[:TOOL_ARG_LIMIT]
    if name == "bash" and "command" in args:
        cmd = str(args["command"])
        return "`" + cmd[:TOOL_ARG_LIMIT].replace("\n", " ; ") + "`"
    parts = []
    for k, v in args.items():
        s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
        parts.append(f"{k}={s}")
    return "`" + ("; ".join(parts))[:TOOL_ARG_LIMIT].replace("\n", " ") + "`"


def truncate(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + f"\n… _[{len(text) - limit} chars truncated]_"


def export_session(path: Path) -> tuple[str, dict]:
    session = {
        "file": path.name,
        "id": path.stem,
        "started": None,
        "cwd": "",
        "model": "",
        "user_prompts": 0,
        "messages": 0,
    }
    lines = []
    pending_tools: dict[str, list[dict]] = {}

    def emit(line: str = ""):
        lines.append(line)

    with path.open(encoding="utf-8") as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError:
                continue
            kind = obj.get("type")
            if kind == "session":
                session["id"] = obj.get("id", session["id"])
                session["started"] = obj.get("timestamp")
                session["cwd"] = obj.get("cwd", "")
                continue
            if kind == "model_change":
                session["model"] = f"{obj.get('provider','?')}/{obj.get('modelId','?')}"
                continue
            if kind != "message":
                continue

            msg = obj.get("message", {})
            role = msg.get("role")
            ts = obj.get("timestamp", "")
            session["messages"] += 1

            if role == "user":
                text = redact(stringify_content(msg.get("content")))
                if not text:
                    continue
                session["user_prompts"] += 1
                emit()
                emit(f"### 👤 User · {ts}")
                emit()
                emit(text)
                emit()

            elif role == "assistant":
                thinking, text, tools = [], [], []
                for b in blocks(msg.get("content")):
                    btype = b.get("type", "")
                    if btype == "text":
                        text.append(b.get("text", ""))
                    elif btype == "thinking":
                        thinking.append(b.get("thinking") or b.get("text", ""))
                    elif "tool" in btype.lower():
                        tools.append(b)
                if not (thinking or text or tools):
                    continue
                emit(f"### 🤖 Assistant · {ts}")
                emit()
                if text:
                    emit(redact("\n".join(text).strip()))
                    emit()
                for th in thinking:
                    if th.strip():
                        emit("<details><summary>🧠 Thinking</summary>")
                        emit()
                        emit(redact(truncate(th, THINK_LIMIT)))
                        emit()
                        emit("</details>")
                        emit()
                if tools:
                    emit(f"<details><summary>🛠 Tools ({len(tools)})</summary>")
                    emit()
                    for t in tools:
                        name = t.get("name") or t.get("toolName") or "tool"
                        call_id = t.get("id") or t.get("toolCallId") or ""
                        emit(f"- **{name}** — {redact(fmt_args(name, t.get('arguments')))}")
                        pending_tools.setdefault(call_id, []).append(t)
                    emit()
                    emit("</details>")
                    emit()

            elif role in ("toolResult", "tool"):
                call_id = msg.get("toolCallId") or ""
                tool_name = msg.get("toolName", "tool")
                result = redact(truncate(stringify_content(msg.get("content")), TOOL_RESULT_LIMIT))
                emit(f"  <sub>↳ `{tool_name}` result: {result.replace(chr(10), ' ')}</sub>")
                emit()

    header = [
        f"# Chat session {session['id']}",
        "",
        f"- **Started:** {session['started']}",
        f"- **Model:** {session['model'] or 'unknown'}",
        f"- **Working dir:** `{session['cwd']}`",
        f"- **Source log:** `{path.name}`",
        f"- **User prompts:** {session['user_prompts']}",
        "",
        "---",
        "",
    ]
    content = "\n".join(header + lines).rstrip() + "\n"
    return content, session


def main() -> int:
    repo = Path(__file__).resolve().parent.parent
    slug = "--" + re.sub(r"[:\\/]", "-", str(repo)) + "--"
    default_sessions = Path.home() / ".pi" / "agent" / "sessions" / slug

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sessions", type=Path, default=default_sessions)
    ap.add_argument("--out", type=Path, default=repo / "docs" / "chat-history")
    args = ap.parse_args()

    if not args.sessions.is_dir():
        print(f"Session directory not found: {args.sessions}", file=sys.stderr)
        return 1

    files = sorted(args.sessions.glob("*.jsonl"))
    if not files:
        print(f"No session logs in {args.sessions}", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    index_rows = []
    for i, path in enumerate(files, start=1):
        content, session = export_session(path)
        started = session["started"] or ""
        try:
            stamp = datetime.fromisoformat(started.replace("Z", "+00:00"))
        except ValueError:
            stamp = None
        date = stamp.strftime("%Y-%m-%d %H:%M") if stamp else started
        name = f"session-{i:02d}-{date.replace(' ', 'T').replace(':', '')}.md"
        (args.out / name).write_text(content, encoding="utf-8")
        index_rows.append((i, name, date, session))
        print(f"wrote {name} ({len(content):,} bytes, {session['messages']} messages)")

    readme = [
        "# Chat history",
        "",
        "Rebuilt from the pi session logs for this repository. Each file is a transcript of one",
        "coding session: user prompts, assistant replies, reasoning, and tool activity.",
        "",
        "Regenerate with:",
        "",
        "```bash",
        "python scripts/export-chat-history.py",
        "```",
        "",
        "| # | Session | Started | Model | Prompts | Messages |",
        "|---|---------|---------|-------|---------|----------|",
    ]
    for i, name, date, s in index_rows:
        readme.append(
            f"| {i} | [{name}]({name}) | {date} | {s['model'] or '—'} | {s['user_prompts']} | {s['messages']} |"
        )
    readme.append("")
    (args.out / "README.md").write_text("\n".join(readme), encoding="utf-8")
    print(f"wrote README.md with {len(index_rows)} sessions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

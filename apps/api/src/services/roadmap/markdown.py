"""Minimal Markdown -> ProseMirror conversion for imported lecture material.

Only the block types the course editor can always render are produced
(paragraph, heading, lists, codeBlock, calloutInfo, horizontalRule, blockImage).
Inline syntax is limited to bold/italic/inline code/links, which is exactly what
a roadmap author realistically writes; anything else is kept as plain text
instead of being dropped.
"""

from __future__ import annotations

import re
from typing import List, Optional

_INLINE_RE = re.compile(
    r"(?P<bold>\*\*(?P<bold_text>.+?)\*\*)"
    r"|(?P<italic>(?<!\*)\*(?!\*)(?P<italic_text>.+?)(?<!\*)\*(?!\*))"
    r"|(?P<code>`(?P<code_text>[^`]+)`)"
    r"|(?P<link>\[(?P<link_text>[^\]]+)\]\((?P<link_href>[^)\s]+)\))"
)

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET_RE = re.compile(r"^\s*[-*+]\s+(.*)$")
_ORDERED_RE = re.compile(r"^\s*\d+[.)]\s+(.*)$")
_IMAGE_RE = re.compile(r"^!\[(?P<alt>[^\]]*)\]\((?P<src>[^)\s]+)\)$")
_FENCE_RE = re.compile(r"^```\s*([\w+-]*)\s*$")


def _inline_nodes(text: str) -> List[dict]:
    nodes: List[dict] = []
    position = 0
    for match in _INLINE_RE.finditer(text):
        if match.start() > position:
            nodes.append({"type": "text", "text": text[position:match.start()]})
        if match.group("bold"):
            nodes.append({
                "type": "text",
                "text": match.group("bold_text"),
                "marks": [{"type": "bold"}],
            })
        elif match.group("italic"):
            nodes.append({
                "type": "text",
                "text": match.group("italic_text"),
                "marks": [{"type": "italic"}],
            })
        elif match.group("code"):
            nodes.append({
                "type": "text",
                "text": match.group("code_text"),
                "marks": [{"type": "code"}],
            })
        elif match.group("link"):
            href = match.group("link_href")
            nodes.append({
                "type": "text",
                "text": match.group("link_text"),
                "marks": [{"type": "link", "attrs": {"href": href, "target": "_blank"}}],
            })
        position = match.end()
    if position < len(text):
        nodes.append({"type": "text", "text": text[position:]})
    return [node for node in nodes if node.get("text")]


def _paragraph(text: str) -> dict:
    content = _inline_nodes(text.strip())
    node: dict = {"type": "paragraph"}
    if content:
        node["content"] = content
    return node


def _text_block(text: str) -> dict:
    return {"type": "text", "text": text}


def _list_item(text: str) -> dict:
    return {"type": "listItem", "content": [_paragraph(text)]}


def markdown_to_prosemirror(markdown: Optional[str]) -> dict:
    """Convert Markdown to a ProseMirror ``doc``.

    Empty/None input yields an empty document, which the editor renders as a
    blank page and the roadmap job treats as "needs generation".
    """
    if not markdown or not markdown.strip():
        return {"type": "doc", "content": []}

    lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: List[dict] = []
    paragraph_buffer: List[str] = []
    list_buffer: List[str] = []
    list_kind: Optional[str] = None

    def flush_paragraph() -> None:
        nonlocal paragraph_buffer
        if paragraph_buffer:
            blocks.append(_paragraph(" ".join(part.strip() for part in paragraph_buffer)))
            paragraph_buffer = []

    def flush_list() -> None:
        nonlocal list_buffer, list_kind
        if list_buffer and list_kind:
            blocks.append({
                "type": "bulletList" if list_kind == "bullet" else "orderedList",
                "content": [_list_item(item) for item in list_buffer],
            })
        list_buffer = []
        list_kind = None

    index = 0
    while index < len(lines):
        raw = lines[index]
        line = raw.rstrip()
        stripped = line.strip()

        fence = _FENCE_RE.match(stripped)
        if fence:
            flush_paragraph()
            flush_list()
            language = fence.group(1) or None
            code_lines: List[str] = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code_lines.append(lines[index])
                index += 1
            code = "\n".join(code_lines)
            node: dict = {"type": "codeBlock", "attrs": {"language": language}}
            if code:
                node["content"] = [_text_block(code)]
            blocks.append(node)
            index += 1
            continue

        if not stripped:
            flush_paragraph()
            flush_list()
            index += 1
            continue

        image = _IMAGE_RE.match(stripped)
        if image:
            flush_paragraph()
            flush_list()
            blocks.append({
                "type": "blockImage",
                "attrs": {"src": image.group("src"), "alt": image.group("alt")},
            })
            index += 1
            continue

        heading = _HEADING_RE.match(stripped)
        if heading:
            flush_paragraph()
            flush_list()
            level = len(heading.group(1))
            text = heading.group(2).strip()
            node = {"type": "heading", "attrs": {"level": level}}
            content = _inline_nodes(text)
            if content:
                node["content"] = content
            blocks.append(node)
            index += 1
            continue

        if re.match(r"^(---+|\*\*\*+|___+)$", stripped):
            flush_paragraph()
            flush_list()
            blocks.append({"type": "horizontalRule"})
            index += 1
            continue

        if stripped.startswith(">"):
            flush_paragraph()
            flush_list()
            quote_lines: List[str] = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quote_lines.append(lines[index].strip()[1:].strip())
                index += 1
            text = " ".join(part for part in quote_lines if part)
            blocks.append({
                "type": "calloutInfo",
                "content": [_paragraph(text)] if text else [],
            })
            continue

        bullet = _BULLET_RE.match(line)
        ordered = _ORDERED_RE.match(line)
        if bullet or ordered:
            flush_paragraph()
            kind = "bullet" if bullet else "ordered"
            if list_kind and list_kind != kind:
                flush_list()
            list_kind = kind
            list_buffer.append((bullet or ordered).group(1).strip())
            index += 1
            continue

        flush_list()
        paragraph_buffer.append(line)
        index += 1

    flush_paragraph()
    flush_list()
    return {"type": "doc", "content": blocks}


def markdown_is_empty(document: Optional[dict]) -> bool:
    return not document or not document.get("content")

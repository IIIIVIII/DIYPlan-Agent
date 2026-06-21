#!/usr/bin/env python3
"""Extract selected PDF pages into SVG fixtures for source-manual rendering.

Example:
  ml/.venv/bin/python scripts/extract-manual-fixtures.py \
    --pdf /Users/mingfanxie/Desktop/diy.pdf \
    --pages 6-12 \
    --out public/assets/manuals/grimsarbo
"""

from __future__ import annotations

import argparse
from pathlib import Path

import fitz


def parse_pages(value: str) -> list[int]:
    pages: list[int] = []
    for chunk in value.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            start, end = [int(x) for x in chunk.split("-", 1)]
            pages.extend(range(start, end + 1))
        else:
            pages.append(int(chunk))
    return sorted(set(pages))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--pages", required=True, help="1-based pages, e.g. 6-12 or 1,3,5")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    if not args.pdf.is_file():
        raise SystemExit(f"PDF not found: {args.pdf}")

    args.out.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(args.pdf)
    for page_no in parse_pages(args.pages):
        if page_no < 1 or page_no > len(doc):
            raise SystemExit(f"Page {page_no} outside document range 1-{len(doc)}")
        page = doc[page_no - 1]
        svg = page.get_svg_image(text_as_path=True)
        out_path = args.out / f"page-{page_no:02d}.svg"
        out_path.write_text(svg, encoding="utf-8")
        print(f"wrote {out_path} ({len(svg)} chars)")


if __name__ == "__main__":
    main()

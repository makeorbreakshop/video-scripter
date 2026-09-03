#!/usr/bin/env python3
"""Render side-by-side, title-blind contact sheets for thumbnail retrieval review."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps


CELL_WIDTH = 260
IMAGE_HEIGHT = 146
LABEL_HEIGHT = 30
GUTTER = 8


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pool", type=Path, required=True)
    parser.add_argument("--image-cache", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--max-edge", type=int, default=640)
    return parser.parse_args()


def cached_path(url: str, cache_dir: Path, max_edge: int) -> Path:
    cache_key = hashlib.sha256(url.encode("utf-8")).hexdigest()
    return cache_dir / f"{cache_key}.fit-{max_edge}.jpg"


def thumbnail(payload: dict[str, Any], cache_dir: Path, max_edge: int) -> Image.Image:
    path = cached_path(payload["thumbnail_url"], cache_dir, max_edge)
    with Image.open(path) as source:
        image = ImageOps.fit(ImageOps.exif_transpose(source).convert("RGB"), (CELL_WIDTH, IMAGE_HEIGHT))
    return image


def place(
    sheet: Image.Image,
    draw: ImageDraw.ImageDraw,
    payload: dict[str, Any],
    *,
    row: int,
    column: int,
    label: str,
    cache_dir: Path,
    max_edge: int,
) -> None:
    x = GUTTER + column * (CELL_WIDTH + GUTTER)
    y = GUTTER + row * (IMAGE_HEIGHT + LABEL_HEIGHT + GUTTER)
    sheet.paste(thumbnail(payload, cache_dir, max_edge), (x, y))
    draw.text((x + 4, y + IMAGE_HEIGHT + 6), label, fill="white", font=ImageFont.load_default())


def main() -> None:
    args = parse_args()
    pool = json.loads(args.pool.read_text(encoding="utf-8"))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for query_index, query in enumerate(pool["queries"], start=1):
        visual = query["visual"]["neighbors"]
        visual_title = query["visualTitle"]["neighbors"]
        columns = 1 + max(len(visual), len(visual_title))
        width = GUTTER + columns * (CELL_WIDTH + GUTTER)
        height = GUTTER + 2 * (IMAGE_HEIGHT + LABEL_HEIGHT + GUTTER)
        sheet = Image.new("RGB", (width, height), "#111111")
        draw = ImageDraw.Draw(sheet)
        for row, (name, neighbors) in enumerate((("A", visual), ("B", visual_title))):
            place(sheet, draw, query["seed"], row=row, column=0, label=f"Seed ({name})",
                  cache_dir=args.image_cache, max_edge=args.max_edge)
            for rank, neighbor in enumerate(neighbors, start=1):
                place(sheet, draw, neighbor, row=row, column=rank, label=f"{name}{rank}",
                      cache_dir=args.image_cache, max_edge=args.max_edge)
        video_id = query["seed"]["video_id"].replace("/", "_")
        sheet.save(args.output_dir / f"{query_index:02d}-{video_id}.jpg", quality=92)
    print(json.dumps({"sheets": len(pool["queries"]), "outputDir": str(args.output_dir)}))


if __name__ == "__main__":
    main()

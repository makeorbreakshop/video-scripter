#!/usr/bin/env python3
"""Download and locally embed a bounded thumbnail manifest with WeMM."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps


MAX_IMAGE_BYTES = 12 * 1024 * 1024
USER_AGENT = "ChannelSmith-Thumbnail-Experiment/1.0"


@dataclass(frozen=True)
class DownloadedThumbnail:
    candidate: dict[str, Any]
    path: Path
    perceptual_hash: str
    content_sha256: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--image-cache", type=Path, required=True)
    parser.add_argument("--model", default="tencent/WeMM-Embedding-4B")
    parser.add_argument("--revision", required=True)
    parser.add_argument("--preprocessing", required=True)
    parser.add_argument("--max-edge", type=int, default=640)
    parser.add_argument("--dimensions", type=int, default=512)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--device", choices=("auto", "mps", "cuda", "cpu"), default="auto")
    parser.add_argument("--allow-cpu", action="store_true")
    return parser.parse_args()


def fetch_bytes(url: str, attempts: int = 3) -> bytes:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=20) as response:
                content_length = response.headers.get("content-length")
                if content_length and int(content_length) > MAX_IMAGE_BYTES:
                    raise ValueError("thumbnail exceeds the 12 MiB limit")
                body = response.read(MAX_IMAGE_BYTES + 1)
                if len(body) > MAX_IMAGE_BYTES:
                    raise ValueError("thumbnail exceeds the 12 MiB limit")
                return body
        except (OSError, ValueError, urllib.error.URLError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2**attempt)
    raise RuntimeError(str(last_error) if last_error else "download failed")


def perceptual_dhash(image: Image.Image) -> str:
    gray = ImageOps.exif_transpose(image).convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    pixels = list(gray.getdata())
    value = 0
    for row in range(8):
        for column in range(8):
            value = (value << 1) | int(pixels[row * 9 + column] > pixels[row * 9 + column + 1])
    return f"{value:016x}"


def download_candidate(candidate: dict[str, Any], cache_dir: Path, max_edge: int) -> DownloadedThumbnail:
    video_id = candidate["videoId"]
    cache_key = hashlib.sha256(candidate["thumbnailUrl"].encode("utf-8")).hexdigest()
    raw_path = cache_dir / f"{cache_key}.img"
    processed_path = cache_dir / f"{cache_key}.fit-{max_edge}.jpg"
    body = raw_path.read_bytes() if raw_path.exists() else fetch_bytes(candidate["thumbnailUrl"])
    if not raw_path.exists():
        raw_path.write_bytes(body)
    content_sha256 = hashlib.sha256(body).hexdigest()
    with Image.open(raw_path) as image:
        image.verify()
    with Image.open(raw_path) as image:
        width, height = image.size
        if width < 32 or height < 18:
            raise ValueError(f"thumbnail is unexpectedly small ({width}x{height})")
        image_hash = perceptual_dhash(image)
        if not processed_path.exists():
            normalized = ImageOps.exif_transpose(image).convert("RGB")
            normalized.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            normalized.save(processed_path, format="JPEG", quality=95, optimize=True)
    print(f"downloaded {video_id}", file=sys.stderr, flush=True)
    return DownloadedThumbnail(candidate, processed_path, image_hash, content_sha256)


def resolve_device(requested: str, allow_cpu: bool) -> tuple[str, Any]:
    import torch

    if requested == "auto":
        if torch.backends.mps.is_available():
            return "mps", torch.float16
        if torch.cuda.is_available():
            return "cuda", torch.float16
        if allow_cpu:
            return "cpu", torch.float32
        raise RuntimeError("no MPS/CUDA device is available; pass --allow-cpu to permit CPU inference")
    if requested == "cpu" and not allow_cpu:
        raise RuntimeError("CPU inference requires --allow-cpu")
    if requested == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS was requested but is unavailable")
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is unavailable")
    return requested, torch.float32 if requested == "cpu" else torch.float16


def serializable_vector(vector: Any) -> list[float]:
    return [float(value) for value in vector.tolist()]


def write_output(
    path: Path,
    *,
    model: str,
    model_revision: str,
    preprocessing: str,
    dimensions: int,
    device: str,
    downloads: int,
    failures: list[dict[str, str]],
    rows: list[dict[str, Any]],
) -> None:
    payload = {
        "model": model,
        "modelRevision": model_revision,
        "preprocessing": preprocessing,
        "dimensions": dimensions,
        "device": device,
        "downloads": downloads,
        "failures": failures,
        "rows": rows,
    }
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def load_checkpoint(
    path: Path,
    *,
    model: str,
    model_revision: str,
    preprocessing: str,
    dimensions: int,
    representatives: list[DownloadedThumbnail],
) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        checkpoint = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if (checkpoint.get("model") != model or checkpoint.get("modelRevision") != model_revision
            or checkpoint.get("preprocessing") != preprocessing
            or checkpoint.get("dimensions") != dimensions):
        return []
    current = {item.perceptual_hash: item for item in representatives}
    reusable: list[dict[str, Any]] = []
    for row in checkpoint.get("rows", []):
        image_hash = row.get("perceptualHash")
        representative = current.get(image_hash)
        vectors = (row.get("visual"), row.get("visualTitle"))
        if (not representative or row.get("candidate", {}).get("videoId") != representative.candidate["videoId"]
                or row.get("candidate", {}).get("title") != representative.candidate["title"]
                or any(not isinstance(vector, list) or len(vector) != dimensions
                       or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in vector)
                       for vector in vectors)):
            continue
        reusable.append(row)
    return reusable


def main() -> None:
    args = parse_args()
    if args.dimensions < 1 or args.batch_size < 1 or args.max_edge < 64:
        raise ValueError("dimensions/batch size must be positive and max edge must be at least 64")
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    candidates = manifest.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("manifest must contain at least one candidate")

    args.image_cache.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.MAX_IMAGE_PIXELS = 20_000_000

    downloaded: list[DownloadedThumbnail] = []
    failures: list[dict[str, str]] = []
    for candidate in candidates:
        try:
            downloaded.append(download_candidate(candidate, args.image_cache, args.max_edge))
        except Exception as error:  # failures are data, not a reason to fabricate a vector
            failures.append({"videoId": str(candidate.get("videoId", "unknown")), "reason": str(error)[:300]})

    groups: dict[str, list[DownloadedThumbnail]] = {}
    for item in downloaded:
        groups.setdefault(item.perceptual_hash, []).append(item)
    representatives = [sorted(group, key=lambda item: item.candidate["videoId"])[0]
                       for _, group in sorted(groups.items())]
    if not representatives:
        write_output(args.output, model=args.model, model_revision=args.revision,
                     preprocessing=args.preprocessing,
                     dimensions=args.dimensions, device="unavailable",
                     downloads=0, failures=failures, rows=[])
        raise RuntimeError("no thumbnails downloaded successfully")

    rows = load_checkpoint(
        args.output,
        model=args.model,
        model_revision=args.revision,
        preprocessing=args.preprocessing,
        dimensions=args.dimensions,
        representatives=representatives,
    )
    completed_hashes = {row["perceptualHash"] for row in rows}
    remaining = [item for item in representatives if item.perceptual_hash not in completed_hashes]
    if rows:
        print(f"resuming from {len(rows)} checkpointed thumbnails", file=sys.stderr, flush=True)
    if not remaining:
        write_output(args.output, model=args.model, model_revision=args.revision,
                     preprocessing=args.preprocessing,
                     dimensions=args.dimensions, device=args.device,
                     downloads=len(downloaded), failures=failures, rows=rows)
        return

    device, dtype = resolve_device(args.device, args.allow_cpu)
    print(f"loading {args.model} on {device}", file=sys.stderr, flush=True)
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(
        args.model,
        trust_remote_code=True,
        revision=args.revision,
        device=device,
        model_kwargs={"dtype": dtype},
    )
    supported_dimensions = getattr(model[0].auto_model.config, "matryoshka_dimensions", None)
    if supported_dimensions and args.dimensions not in supported_dimensions:
        raise ValueError(f"dimension {args.dimensions} is not supported: {supported_dimensions}")

    for start in range(0, len(remaining), args.batch_size):
        batch = remaining[start:start + args.batch_size]
        visual_inputs = [{"image": str(item.path)} for item in batch]
        visual_title_inputs = [
            {"image": str(item.path), "text": f"YouTube title: {item.candidate['title']}"}
            for item in batch
        ]
        visual = model.encode_document(
            visual_inputs,
            batch_size=args.batch_size,
            truncate_dim=args.dimensions,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        visual_title = model.encode_document(
            visual_title_inputs,
            batch_size=args.batch_size,
            truncate_dim=args.dimensions,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        for index, item in enumerate(batch):
            linked_ids = sorted(member.candidate["videoId"] for member in groups[item.perceptual_hash])
            rows.append({
                "candidate": item.candidate,
                "linkedVideoIds": linked_ids,
                "perceptualHash": item.perceptual_hash,
                "contentSha256": item.content_sha256,
                "visual": serializable_vector(visual[index]),
                "visualTitle": serializable_vector(visual_title[index]),
            })
        write_output(args.output, model=args.model, model_revision=args.revision,
                     preprocessing=args.preprocessing,
                     dimensions=args.dimensions, device=device,
                     downloads=len(downloaded), failures=failures, rows=rows)
        print(f"embedded {len(rows)}/{len(representatives)} unique thumbnails", file=sys.stderr, flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"thumbnail worker failed: {error}", file=sys.stderr)
        raise

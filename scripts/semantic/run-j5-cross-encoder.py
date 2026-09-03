#!/usr/bin/env python3
"""Score frozen J5 dev pairs with a pinned local cross-encoder."""

import argparse
import hashlib
import json
import platform
import time
from pathlib import Path

import numpy as np
import sentence_transformers
import torch
from huggingface_hub import snapshot_download
from sentence_transformers import CrossEncoder

MODEL = "cross-encoder/ms-marco-MiniLM-L6-v2"
REVISION = "233902d25c440f23af6f7d6e94d2946bac0bee0a"
MAX_LENGTH = 512
BATCH_SIZE = 32


def canonical_hash(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def synchronize(device: str) -> None:
    if device == "mps":
        torch.mps.synchronize()


def stable_order(ids: list[str], scores: np.ndarray) -> list[str]:
    return [item[0] for item in sorted(zip(ids, scores.tolist()), key=lambda item: (-item[1], item[0]))]


def file_hash(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    payload = json.loads(input_path.read_text())
    if payload.get("split") != "dev" or any(not task["task_id"].startswith("j5-") for task in payload["body"]["tasks"]):
        raise ValueError("cross-encoder input must contain only J5 dev tasks")
    if canonical_hash(payload["body"]) != payload["content_hash"]:
        raise ValueError("cross-encoder input hash mismatch")

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    load_started = time.perf_counter_ns()
    model = CrossEncoder(MODEL, revision=REVISION, max_length=MAX_LENGTH, device=device)
    load_ms = (time.perf_counter_ns() - load_started) / 1_000_000
    snapshot = Path(snapshot_download(MODEL, revision=REVISION, local_files_only=True))
    model_files = {str(file.relative_to(snapshot)): file_hash(file.resolve()) for file in sorted(snapshot.rglob("*")) if file.is_file()}
    task_results = []
    for task in payload["body"]["tasks"]:
        ids = [candidate["entity_id"] for candidate in task["candidates"]]
        pairs = [(task["seed_document"], candidate["document"]) for candidate in task["candidates"]]
        token_lengths = [len(model.tokenizer(query, document, truncation=False)["input_ids"]) for query, document in pairs]
        warm_scores = np.asarray(model.predict(
            pairs, batch_size=BATCH_SIZE, show_progress_bar=False,
            activation_fn=torch.nn.Identity(), convert_to_numpy=True,
        )).reshape(-1)
        warm_order = stable_order(ids, warm_scores)
        timings = []
        first_scores = None
        for _ in range(5):
            synchronize(device)
            started = time.perf_counter_ns()
            scores = np.asarray(model.predict(
                pairs, batch_size=BATCH_SIZE, show_progress_bar=False,
                activation_fn=torch.nn.Identity(), convert_to_numpy=True,
            )).reshape(-1)
            synchronize(device)
            timings.append((time.perf_counter_ns() - started) / 1_000_000)
            if stable_order(ids, scores) != warm_order:
                raise RuntimeError(f"{task['task_id']}: repeated cross-encoder ranking changed")
            if first_scores is None:
                first_scores = scores
        task_results.append({
            "task_id": task["task_id"],
            "candidate_count": len(ids),
            "truncated_pair_count": sum(length > MAX_LENGTH for length in token_lengths),
            "max_untruncated_tokens": max(token_lengths),
            "timing_ms": timings,
            "scores": [{"entity_id": entity_id, "score": float(score)} for entity_id, score in zip(ids, first_scores.tolist())],
        })

    body = {
        "input_content_hash": payload["content_hash"],
        "model": MODEL,
        "model_revision": REVISION,
        "model_files_sha256": model_files,
        "max_length": MAX_LENGTH,
        "batch_size": BATCH_SIZE,
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "sentence_transformers": sentence_transformers.__version__,
            "torch": torch.__version__,
            "device": device,
            "model_load_ms": load_ms,
        },
        "tasks": task_results,
    }
    body_json = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    output = {"version": 1, "body_json": body_json, "content_hash": hashlib.sha256(body_json.encode()).hexdigest()}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, separators=(",", ":"), ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()

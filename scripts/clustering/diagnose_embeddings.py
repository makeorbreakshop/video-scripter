#!/usr/bin/env python3
"""
Diagnose embedding characteristics
"""
import json
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
import random

print("Loading embeddings for diagnosis...")
with open('embeddings-part-1.json', 'r') as f:
    data = json.load(f)

embeddings = np.array([e['values'] for e in data['embeddings'][:5000]])
titles = [e.get('metadata', {}).get('title', 'Unknown') for e in data['embeddings'][:5000]]

print(f"\nEmbedding Statistics:")
print(f"Shape: {embeddings.shape}")
print(f"Mean: {np.mean(embeddings):.4f}")
print(f"Std: {np.std(embeddings):.4f}")
print(f"Min: {np.min(embeddings):.4f}")
print(f"Max: {np.max(embeddings):.4f}")

# Check similarity distribution
print("\nComputing pairwise similarities...")
sample_size = 1000
sample_idx = random.sample(range(len(embeddings)), sample_size)
sample_emb = embeddings[sample_idx]
similarities = cosine_similarity(sample_emb)

# Remove self-similarities
mask = ~np.eye(similarities.shape[0], dtype=bool)
similarities = similarities[mask]

print(f"\nSimilarity Distribution (sample of {sample_size}):")
print(f"Mean similarity: {np.mean(similarities):.4f}")
print(f"Std similarity: {np.std(similarities):.4f}")
print(f"Min similarity: {np.min(similarities):.4f}")
print(f"Max similarity: {np.max(similarities):.4f}")

# Show percentiles
percentiles = [10, 25, 50, 75, 90, 95, 99]
for p in percentiles:
    print(f"{p}th percentile: {np.percentile(similarities, p):.4f}")

# Find most similar pairs
print("\nMost Similar Video Pairs:")
sim_matrix = cosine_similarity(embeddings[:1000])  # First 1000 for speed
np.fill_diagonal(sim_matrix, 0)  # Remove self-similarity

for i in range(5):
    max_idx = np.unravel_index(np.argmax(sim_matrix), sim_matrix.shape)
    similarity = sim_matrix[max_idx]
    if similarity > 0:
        title1 = titles[max_idx[0]][:60] if titles[max_idx[0]] != 'Unknown' else 'Unknown'
        title2 = titles[max_idx[1]][:60] if titles[max_idx[1]] != 'Unknown' else 'Unknown'
        print(f"\nSimilarity: {similarity:.4f}")
        print(f"  1: {title1}")
        print(f"  2: {title2}")
        sim_matrix[max_idx] = 0  # Zero out for next iteration

print("\n\nDIAGNOSIS:")
if np.mean(similarities) > 0.7:
    print("❌ Embeddings are too similar - may need different embedding model")
elif np.mean(similarities) < 0.2:
    print("❌ Embeddings are too sparse - clustering will be difficult")
else:
    print("✅ Embedding similarity distribution looks reasonable")

if np.std(similarities) < 0.1:
    print("❌ Low variance in similarities - little structure to find")
else:
    print("✅ Good variance in similarities")
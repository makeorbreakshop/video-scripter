#!/usr/bin/env python3
"""
Recreate the exact same sample indices used in bertopic-practical-solution.py
"""

import numpy as np
import pickle
from sklearn.cluster import MiniBatchKMeans

print("Recreating sample indices...")

# Load embeddings
with open('bertopic_embeddings.pkl', 'rb') as f:
    embeddings = pickle.load(f)

if not isinstance(embeddings, np.ndarray):
    embeddings = np.array(embeddings)

print(f"Loaded {len(embeddings):,} embeddings")

# Recreate the exact same stratified sample
np.random.seed(42)  # Same seed as original
sample_size = 30000
n_total = len(embeddings)

# Use K-means to create strata (same as original)
n_strata = 100
kmeans = MiniBatchKMeans(n_clusters=n_strata, batch_size=1000, random_state=42)
strata_labels = kmeans.fit_predict(embeddings)

# Sample proportionally from each stratum (same logic as original)
sample_indices = []
samples_per_stratum = sample_size // n_strata

for stratum in range(n_strata):
    stratum_indices = np.where(strata_labels == stratum)[0]
    if len(stratum_indices) > samples_per_stratum:
        sampled = np.random.choice(stratum_indices, samples_per_stratum, replace=False)
    else:
        sampled = stratum_indices
    sample_indices.extend(sampled)

sample_indices = np.array(sample_indices)

print(f"Recreated sample with {len(sample_indices):,} indices")

# Save for future use
with open('bertopic_sample_indices.pkl', 'wb') as f:
    pickle.dump(sample_indices, f)

print("Saved to bertopic_sample_indices.pkl")

# Verify by loading documents and showing first few samples
with open('bertopic_documents.pkl', 'rb') as f:
    documents = pickle.load(f)

print("\nFirst 5 sampled documents:")
for i in sample_indices[:5]:
    print(f"  {i}: {documents[i][:60]}...")
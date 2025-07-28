"""
Test HDBSCAN on 10K subset
"""

import json
import numpy as np
import hdbscan
from datetime import datetime
from collections import Counter
from tqdm import tqdm

print("📂 Loading embeddings...")
with open('/Users/brandoncullum/video-scripter/exports/title-embeddings-complete-aggregated.json', 'r') as f:
    data = json.load(f)

# Take first 10K
subset = data['embeddings'][:10000]
print(f"✅ Using {len(subset)} embeddings for testing")

# Extract embeddings
embeddings = []
metadata = []

for item in tqdm(subset, desc="Processing"):
    if 'values' in item and len(item['values']) == 512:
        embeddings.append(item['values'])
        metadata.append({
            'id': item['id'],
            'title': item.get('metadata', {}).get('title', ''),
            'channel': item.get('metadata', {}).get('channel_name', ''),
            'views': item.get('metadata', {}).get('view_count', 0)
        })

X = np.array(embeddings)
print(f"\n✅ Prepared {X.shape} array")

# Test different parameters
for min_cluster_size in [30, 50, 100]:
    print(f"\n🧪 Testing min_cluster_size={min_cluster_size}")
    
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=10,
        metric='euclidean',
        cluster_selection_method='eom'
    )
    
    labels = clusterer.fit_predict(X)
    
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = list(labels).count(-1)
    
    print(f"   Clusters: {n_clusters}, Noise: {n_noise} ({n_noise/len(labels)*100:.1f}%)")
    
    # Show top 5 clusters
    cluster_sizes = Counter(labels)
    del cluster_sizes[-1]
    
    for cluster_id, size in cluster_sizes.most_common(5):
        indices = [i for i, l in enumerate(labels) if l == cluster_id]
        titles = [metadata[i]['title'][:50] for i in indices[:3]]
        print(f"   Cluster {cluster_id} ({size} videos): {titles[0]}...")

print("\n✅ Test complete!")
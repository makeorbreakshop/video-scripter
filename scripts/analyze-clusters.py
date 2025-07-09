import csv
import json
from collections import Counter, defaultdict

# Read the CSV file
with open('bertopic_results_20250708_212427.csv', 'r') as f:
    reader = csv.DictReader(f)
    rows = list(reader)

# Count clusters
cluster_counts = Counter(row['cluster'] for row in rows)
print(f'Total rows: {len(rows)}')
print(f'Total unique clusters: {len(cluster_counts)}')

# Filter out noise cluster (-1)
valid_clusters = {k: v for k, v in cluster_counts.items() if k != '-1'}
print(f'Valid clusters (excluding -1): {len(valid_clusters)}')
print(f'Videos in noise cluster (-1): {cluster_counts.get("-1", 0)}')

# Group videos by cluster
clusters = defaultdict(list)
for row in rows:
    clusters[row['cluster']].append({
        'video_id': row['video_id'],
        'title': row['title'],
        'channel_name': row['channel_name'],
        'view_count': int(row['view_count']) if row['view_count'] else 0,
        'performance_ratio': float(row['performance_ratio']) if row['performance_ratio'] else 0
    })

# Show cluster size distribution
size_dist = Counter(len(videos) for cluster, videos in clusters.items() if cluster != '-1')
print(f'\nCluster size distribution:')
for size, count in sorted(size_dist.items()):
    print(f'  {size} videos: {count} clusters')

# Save cluster data for further processing
cluster_data = {
    'total_clusters': len(valid_clusters),
    'noise_videos': cluster_counts.get('-1', 0),
    'clusters': {}
}

for cluster_id, videos in clusters.items():
    if cluster_id != '-1' and len(videos) >= 5:  # Only include clusters with at least 5 videos
        cluster_data['clusters'][cluster_id] = {
            'size': len(videos),
            'videos': sorted(videos, key=lambda x: x['view_count'], reverse=True)[:20]  # Top 20 by views
        }

with open('cluster_data_for_naming.json', 'w') as f:
    json.dump(cluster_data, f, indent=2)

print(f'\nSaved cluster data to cluster_data_for_naming.json')
print(f'Included {len(cluster_data["clusters"])} clusters with 5+ videos')
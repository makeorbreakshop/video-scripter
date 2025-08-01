#!/usr/bin/env python3
"""Analyze the topic hierarchy from BERTopic results"""

import json
from collections import defaultdict

# Load the topic names
with open('topic_names_incremental_20250801_132046.json', 'r') as f:
    data = json.load(f)

# Load the classifications to get actual counts
with open('bertopic_smart_hierarchy_20250801_131446.json', 'r') as f:
    classifications_data = json.load(f)

# Count videos per topic
topic_counts = defaultdict(int)
for video in classifications_data['classifications']:
    for level in ['topic_level_1', 'topic_level_2', 'topic_level_3']:
        topic_id = video.get(level)
        if topic_id != -1:
            topic_counts[f"{level}_{topic_id}"] += 1

# Analyze hierarchy
hierarchy = data['hierarchy']
print(f'Total unique topics: {data["total_topics"]}')
print(f'Level 1 (Super categories): {len(hierarchy["level_1"])} topics')
print(f'Level 2 (Main categories): {len(hierarchy["level_2"])} topics')
print(f'Level 3 (Fine-grained): {len(hierarchy["level_3"])} topics')

# Group by category at each level
print('\n## Level 1 - Super Categories:')
print('-' * 60)
l1_categories = defaultdict(list)
for topic_id, topic in hierarchy['level_1'].items():
    count = topic_counts.get(f'topic_level_1_{topic_id}', 0)
    l1_categories[topic['category']].append({
        'name': topic['name'],
        'subcategory': topic['subcategory'],
        'count': count,
        'id': topic_id
    })

for cat in sorted(l1_categories.keys()):
    topics = sorted(l1_categories[cat], key=lambda x: x['count'], reverse=True)
    total = sum(t['count'] for t in topics)
    print(f'\n{cat} ({total:,} videos):')
    for t in topics:
        print(f'  - {t["name"]} ({t["subcategory"]}): {t["count"]:,} videos')

print('\n\n## Level 2 - Main Categories:')
print('-' * 60)
l2_categories = defaultdict(list)
for topic_id, topic in hierarchy['level_2'].items():
    count = topic_counts.get(f'topic_level_2_{topic_id}', 0)
    l2_categories[topic['category']].append({
        'name': topic['name'],
        'subcategory': topic['subcategory'],
        'count': count,
        'id': topic_id
    })

# Show top 5 categories by video count
cat_totals = [(cat, sum(t['count'] for t in topics)) for cat, topics in l2_categories.items()]
for cat, total in sorted(cat_totals, key=lambda x: x[1], reverse=True)[:5]:
    topics = sorted(l2_categories[cat], key=lambda x: x['count'], reverse=True)[:3]
    print(f'\n{cat} ({total:,} videos, {len(l2_categories[cat])} topics):')
    for t in topics:
        print(f'  - {t["name"]} ({t["subcategory"]}): {t["count"]:,} videos')
    if len(l2_categories[cat]) > 3:
        print(f'  ... and {len(l2_categories[cat]) - 3} more')

print('\n\n## Level 3 - Fine-grained Topics:')
print('-' * 60)
l3_categories = defaultdict(list)
for topic_id, topic in hierarchy['level_3'].items():
    count = topic_counts.get(f'topic_level_3_{topic_id}', 0)
    l3_categories[topic['category']].append({
        'name': topic['name'],
        'subcategory': topic['subcategory'],
        'count': count,
        'id': topic_id
    })

# Show top 10 individual topics
all_l3_topics = []
for cat, topics in l3_categories.items():
    for t in topics:
        t['category'] = cat
        all_l3_topics.append(t)

print('\nTop 15 Topics by Video Count:')
for t in sorted(all_l3_topics, key=lambda x: x['count'], reverse=True)[:15]:
    print(f'{t["count"]:6,} - {t["name"]} ({t["category"]} > {t["subcategory"]})')

# Category distribution
print('\n\n## Category Distribution Across Levels:')
print('-' * 60)
all_categories = set()
all_categories.update(l1_categories.keys())
all_categories.update(l2_categories.keys())
all_categories.update(l3_categories.keys())

for cat in sorted(all_categories):
    l1_count = len(l1_categories.get(cat, []))
    l2_count = len(l2_categories.get(cat, []))
    l3_count = len(l3_categories.get(cat, []))
    if l1_count + l2_count + l3_count > 5:  # Only show categories with significant presence
        print(f'{cat:20} L1: {l1_count:2d} | L2: {l2_count:2d} | L3: {l3_count:3d}')
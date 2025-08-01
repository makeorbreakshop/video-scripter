#!/usr/bin/env python3
"""Analyze the true hierarchical relationships from BERTopic"""

import json
from collections import defaultdict

# Load all the data
with open('bertopic_smart_hierarchy_20250801_131446.json', 'r') as f:
    hierarchy_data = json.load(f)

with open('topic_names_claude_final_20250801_133157.json', 'r') as f:
    names_data = json.load(f)

# Get the mappings
mappings = hierarchy_data['metadata']['mappings']
topic_to_l2 = {int(k): v for k, v in mappings['topic_to_l2'].items()}
l2_to_l1 = {int(k): v for k, v in mappings['l2_to_l1'].items()}

# Count videos per topic at each level
video_counts = defaultdict(int)
for video in hierarchy_data['classifications']:
    for level in ['topic_level_1', 'topic_level_2', 'topic_level_3']:
        topic_id = video[level]
        if topic_id != -1:
            video_counts[f"{level}_{topic_id}"] += 1

# Build the complete hierarchy
hierarchy = {}

# First, identify all L1 topics
l1_topics = set()
for video in hierarchy_data['classifications']:
    if video['topic_level_1'] != -1:
        l1_topics.add(video['topic_level_1'])

# Build L1 structure
for l1 in sorted(l1_topics):
    l1_info = names_data['topics'].get(str(l1), {})
    hierarchy[l1] = {
        'name': l1_info.get('name', f'Topic {l1}'),
        'category': l1_info.get('category', 'Unknown'),
        'keywords': l1_info.get('keywords', ''),
        'video_count': video_counts[f'topic_level_1_{l1}'],
        'l2_children': {}
    }

# Add L2 topics
for l2, l1_parent in l2_to_l1.items():
    if l1_parent in hierarchy:
        l2_info = names_data['topics'].get(str(l2), {})
        hierarchy[l1_parent]['l2_children'][l2] = {
            'name': l2_info.get('name', f'Topic {l2}'),
            'category': l2_info.get('category', 'Unknown'),
            'keywords': l2_info.get('keywords', ''),
            'video_count': video_counts[f'topic_level_2_{l2}'],
            'l3_children': {}
        }

# Add L3 topics
for l3, l2_parent in topic_to_l2.items():
    # Find which L1 this L2 belongs to
    l1_parent = l2_to_l1.get(l2_parent)
    if l1_parent and l1_parent in hierarchy and l2_parent in hierarchy[l1_parent]['l2_children']:
        l3_info = names_data['topics'].get(str(l3), {})
        hierarchy[l1_parent]['l2_children'][l2_parent]['l3_children'][l3] = {
            'name': l3_info.get('name', f'Topic {l3}'),
            'category': l3_info.get('category', 'Unknown'),
            'keywords': l3_info.get('keywords', ''),
            'video_count': video_counts[f'topic_level_3_{l3}']
        }

# Print the complete hierarchy
print("# Complete BERTopic Hierarchical Structure\n")
print(f"Total L1 topics: {len(hierarchy)}")
print(f"Total L2 topics: {len(l2_to_l1)}")
print(f"Total L3 topics: {len(topic_to_l2)}")
print("\n" + "="*100 + "\n")

# Print each L1 and its full tree
for l1_id, l1_data in sorted(hierarchy.items(), key=lambda x: x[1]['video_count'], reverse=True):
    print(f"\n## L1: {l1_data['name']} (ID: {l1_id})")
    print(f"   Category: {l1_data['category']}")
    print(f"   Videos: {l1_data['video_count']:,}")
    print(f"   Keywords: {l1_data['keywords']}")
    
    if l1_data['l2_children']:
        print(f"\n   L2 Topics ({len(l1_data['l2_children'])} total):")
        
        for l2_id, l2_data in sorted(l1_data['l2_children'].items(), 
                                    key=lambda x: x[1]['video_count'], reverse=True):
            print(f"\n   ├─ L2: {l2_data['name']} (ID: {l2_id})")
            print(f"   │  Videos: {l2_data['video_count']:,}")
            print(f"   │  Keywords: {l2_data['keywords'][:50]}...")
            
            if l2_data['l3_children']:
                print(f"   │  L3 Topics ({len(l2_data['l3_children'])} total):")
                
                # Show top 5 L3 topics
                l3_sorted = sorted(l2_data['l3_children'].items(), 
                                 key=lambda x: x[1]['video_count'], reverse=True)
                
                for i, (l3_id, l3_data) in enumerate(l3_sorted[:5]):
                    prefix = "   │  └─" if i == min(4, len(l3_sorted)-1) else "   │  ├─"
                    print(f"{prefix} {l3_data['name']} ({l3_data['video_count']:,} videos)")
                
                if len(l2_data['l3_children']) > 5:
                    print(f"   │  └─ ... and {len(l2_data['l3_children']) - 5} more L3 topics")
    
    print("\n" + "-"*100)

# Summary statistics
print("\n## Summary Statistics")
total_l2_with_children = sum(1 for l1 in hierarchy.values() 
                           for l2 in l1['l2_children'].values() 
                           if l2['l3_children'])
total_l3 = sum(len(l2['l3_children']) for l1 in hierarchy.values() 
             for l2 in l1['l2_children'].values())

print(f"L1 topics with L2 children: {sum(1 for l1 in hierarchy.values() if l1['l2_children'])}")
print(f"L2 topics with L3 children: {total_l2_with_children}")
print(f"Total L3 topics: {total_l3}")
print(f"Average L3 topics per L2: {total_l3/len(l2_to_l1):.1f}")
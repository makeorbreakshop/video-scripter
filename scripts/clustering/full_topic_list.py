#!/usr/bin/env python3
"""
Generate full list of all 1,084 topics with their 3-tier hierarchy
"""
import json

# Load data
with open('improved_topic_categorization.json', 'r') as f:
    data = json.load(f)

# Sort by size (already done in the data)
topics = data['topics']

# Create output file
with open('full_1084_topics_list.txt', 'w') as f:
    f.write('COMPLETE 3-TIER TOPIC HIERARCHY - ALL 1,084 TOPICS\n')
    f.write('=' * 100 + '\n\n')
    
    # Tier 1 - Domains
    f.write('TIER 1: DOMAINS (Top 30 largest topics)\n')
    f.write('-' * 100 + '\n')
    f.write(f'{"Rank":<5} {"ID":<6} {"Topic Name":<45} {"Videos":<8} {"Category":<25} {"Subcategory":<20}\n')
    f.write('-' * 100 + '\n')
    
    for i, topic in enumerate(topics[:30]):
        f.write(f'{i+1:<5} {topic["topic_id"]:<6} {topic["name"]:<45} {topic["size"]:<8} {topic["category"]:<25} {topic["subcategory"]:<20}\n')
    
    # Tier 2 - Niches
    f.write('\n\nTIER 2: NICHES (Topics 31-250)\n')
    f.write('-' * 100 + '\n')
    f.write(f'{"Rank":<5} {"ID":<6} {"Topic Name":<45} {"Videos":<8} {"Category":<25} {"Subcategory":<20}\n')
    f.write('-' * 100 + '\n')
    
    for i, topic in enumerate(topics[30:250]):
        f.write(f'{i+31:<5} {topic["topic_id"]:<6} {topic["name"]:<45} {topic["size"]:<8} {topic["category"]:<25} {topic["subcategory"]:<20}\n')
    
    # Tier 3 - Specific Topics
    f.write('\n\nTIER 3: SPECIFIC TOPICS (Topics 251-1084)\n')
    f.write('-' * 100 + '\n')
    f.write(f'{"Rank":<5} {"ID":<6} {"Topic Name":<45} {"Videos":<8} {"Category":<25} {"Subcategory":<20}\n')
    f.write('-' * 100 + '\n')
    
    for i, topic in enumerate(topics[250:]):
        f.write(f'{i+251:<5} {topic["topic_id"]:<6} {topic["name"]:<45} {topic["size"]:<8} {topic["category"]:<25} {topic["subcategory"]:<20}\n')
    
    # Summary stats
    f.write('\n\nSUMMARY STATISTICS\n')
    f.write('-' * 100 + '\n')
    f.write(f'Total Topics: {len(topics)}\n')
    f.write(f'Tier 1 (Domains): 30 topics\n')
    f.write(f'Tier 2 (Niches): 220 topics\n')
    f.write(f'Tier 3 (Specific): 834 topics\n')
    f.write(f'Total Videos: {sum(t["size"] for t in topics):,}\n')

print("✅ Full topic list saved to: full_1084_topics_list.txt")

# Also create a CSV for easier viewing
import csv

with open('full_1084_topics_list.csv', 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(['Rank', 'Topic_ID', 'Topic_Name', 'Tier', 'Tier_Name', 'Videos', 'Category', 'Subcategory', 'Keywords'])
    
    for i, topic in enumerate(topics):
        writer.writerow([
            i+1,
            topic['topic_id'],
            topic['name'],
            topic['tier'],
            topic['tier_name'],
            topic['size'],
            topic['category'],
            topic['subcategory'],
            ', '.join(topic['keywords'][:5])
        ])

print("✅ CSV version saved to: full_1084_topics_list.csv")
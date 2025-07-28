#!/usr/bin/env python3
"""
Display all categories and their subcategories
"""
import json

# Load data
with open('improved_topic_categorization.json', 'r') as f:
    data = json.load(f)

# Get unique categories and subcategories
cat_subcat = {}
for topic in data['topics']:
    cat = topic['category']
    subcat = topic['subcategory']
    if cat not in cat_subcat:
        cat_subcat[cat] = set()
    cat_subcat[cat].add(subcat)

# Sort by number of topics
sorted_cats = sorted(data['category_summary'].items(), 
                    key=lambda x: x[1]['videos'], reverse=True)

print('📊 Complete Category List (32 total)')
print('=' * 80)
print(f"{'Category':<25} {'Topics':<8} {'Videos':<10} {'Main Subcategories':<30}")
print('-' * 80)

for cat, stats in sorted_cats:
    subcats = sorted(list(cat_subcat[cat]))[:3]  # Show top 3 subcategories
    subcat_str = ', '.join(subcats)
    if len(cat_subcat[cat]) > 3:
        subcat_str += f' (+{len(cat_subcat[cat])-3} more)'
    print(f"{cat:<25} {stats['count']:<8} {stats['videos']:<10,} {subcat_str:<30}")

print('\n📝 Full Subcategory Breakdown:')
print('=' * 80)
for cat in sorted(cat_subcat.keys()):
    subcats = sorted(list(cat_subcat[cat]))
    print(f"\n{cat}:")
    for subcat in subcats:
        # Count topics in this subcategory
        count = sum(1 for t in data['topics'] if t['category'] == cat and t['subcategory'] == subcat)
        print(f"  - {subcat} ({count} topics)")
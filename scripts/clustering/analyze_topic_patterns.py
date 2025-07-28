#!/usr/bin/env python3
"""
Analyze topic patterns to generate semantic names
"""
import json
from collections import Counter
import re

print("Analyzing Topic Patterns for Semantic Naming")
print("=" * 60)

# Load topic keywords
with open('topic_keywords_final.json', 'r') as f:
    topics = json.load(f)

print(f"\nTotal topics: {len(topics)}")
print(f"Total videos: {sum(t['size'] for t in topics):,}")

# Analyze keyword patterns
all_keywords = []
topic_patterns = {}

for topic in topics:
    keywords = topic['keywords']
    all_keywords.extend(keywords)
    
    # Categorize based on keyword patterns
    keywords_str = ' '.join(keywords).lower()
    
    # Programming languages
    if any(lang in keywords_str for lang in ['python', 'javascript', 'java', 'cpp', 'rust', 'golang']):
        category = 'Programming'
    # Web development
    elif any(web in keywords_str for web in ['react', 'vue', 'angular', 'css', 'html', 'wordpress']):
        category = 'Web Development'
    # Data/AI
    elif any(ai in keywords_str for ai in ['machine learning', 'deep learning', 'ai', 'data science', 'tensorflow']):
        category = 'AI/Data Science'
    # Business
    elif any(biz in keywords_str for biz in ['business', 'startup', 'entrepreneur', 'marketing', 'sales']):
        category = 'Business'
    # Finance
    elif any(fin in keywords_str for fin in ['stock', 'trading', 'crypto', 'bitcoin', 'investing']):
        category = 'Finance'
    # Health
    elif any(health in keywords_str for health in ['health', 'fitness', 'weight', 'diet', 'exercise']):
        category = 'Health & Fitness'
    # Gaming
    elif any(game in keywords_str for game in ['minecraft', 'fortnite', 'gaming', 'game', 'roblox']):
        category = 'Gaming'
    # Technology
    elif any(tech in keywords_str for tech in ['3d printing', 'arduino', 'raspberry', 'electronics']):
        category = 'Technology'
    # Education
    elif any(edu in keywords_str for edu in ['tutorial', 'learn', 'course', 'guide', 'howto']):
        category = 'Education'
    else:
        category = 'Other'
    
    if category not in topic_patterns:
        topic_patterns[category] = []
    topic_patterns[category].append(topic)

# Show distribution
print("\n📊 Topic Category Distribution:")
for category, topics_in_cat in sorted(topic_patterns.items(), key=lambda x: len(x[1]), reverse=True):
    count = len(topics_in_cat)
    videos = sum(t['size'] for t in topics_in_cat)
    print(f"  {category:20} {count:4} topics, {videos:6,} videos")

# Analyze top keywords
keyword_freq = Counter(all_keywords)
print("\n🔤 Top 30 Keywords Across All Topics:")
for keyword, count in keyword_freq.most_common(30):
    print(f"  {keyword:20} appears in {count:4} topics")

# Generate semantic names for all topics
semantic_names = []

for topic in topics:
    topic_id = topic['topic_id']
    keywords = topic['keywords']
    size = topic['size']
    
    # Create name based on top keywords
    # Remove common words
    filtered_keywords = [k for k in keywords if k not in ['the', 'and', 'or', 'with', 'for', 'in', 'on', 'at']]
    
    # Generate name
    if len(filtered_keywords) >= 2:
        name = f"{filtered_keywords[0].title()} {filtered_keywords[1].title()}"
        # Add context if available
        if len(filtered_keywords) >= 3:
            name += f" - {filtered_keywords[2].title()}"
    else:
        name = filtered_keywords[0].title() if filtered_keywords else "Unnamed Topic"
    
    semantic_names.append({
        'topic_id': topic_id,
        'generated_name': name,
        'size': size,
        'top_keywords': keywords[:5]
    })

# Save analysis
output = {
    'total_topics': len(topics),
    'category_distribution': {cat: len(topics_list) for cat, topics_list in topic_patterns.items()},
    'semantic_names': semantic_names[:100]  # First 100 for preview
}

with open('topic_pattern_analysis.json', 'w') as f:
    json.dump(output, f, indent=2)

print("\n✅ Analysis complete!")
print("Saved to: topic_pattern_analysis.json")

# Show naming examples
print("\n📝 Sample Semantic Names:")
for topic in semantic_names[:20]:
    print(f"  Topic {topic['topic_id']:3d}: {topic['generated_name']:40} ({topic['size']} videos)")
    print(f"            Keywords: {', '.join(topic['top_keywords'][:3])}")
    print()
#!/usr/bin/env python3
"""
Generate semantic names for BERTopic clusters
"""
import json
import os
from datetime import datetime
from tqdm import tqdm

print("Generating Semantic Names for 1,084 Topics")
print("=" * 60)

# Load topic keywords
with open('topic_keywords_final.json', 'r') as f:
    topics = json.load(f)

print(f"Loaded {len(topics)} topics")

# Manual analysis based on keywords
# This is where Claude Code analyzes the patterns

topic_names = []

for topic in tqdm(topics[:50], desc="Analyzing topics"):  # First 50 for example
    topic_id = topic['topic_id']
    keywords = topic['keywords']
    size = topic['size']
    
    # Analyze keywords to generate semantic name
    # Based on keyword patterns
    
    if 'verstappen' in keywords or 'f1' in keywords:
        name = "Formula 1 Racing"
        category = "Sports"
        
    elif 'niche' in keywords and 'seo' in keywords:
        name = "Niche Website & SEO"
        category = "Digital Marketing"
        
    elif 'business' in keywords and ('100m' in keywords or 'hormozi' in keywords):
        name = "Business Growth & Scaling"
        category = "Entrepreneurship"
        
    elif '3d' in keywords and 'printing' in keywords:
        name = "3D Printing Technology"
        category = "Technology"
        
    elif 'fat' in keywords and 'weight' in keywords and 'exercises' in keywords:
        name = "Weight Loss & Fitness"
        category = "Health & Fitness"
        
    elif 'fat' in keywords and 'insulin' in keywords:
        name = "Metabolic Health & Longevity"
        category = "Health Science"
        
    elif 'python' in keywords or 'programming' in keywords:
        name = "Python Programming"
        category = "Programming"
        
    elif 'react' in keywords or 'javascript' in keywords:
        name = "Web Development - React/JS"
        category = "Programming"
        
    elif 'machine' in keywords and 'learning' in keywords:
        name = "Machine Learning & AI"
        category = "Data Science"
        
    elif 'css' in keywords or 'html' in keywords:
        name = "Web Design & CSS"
        category = "Web Development"
        
    elif 'stock' in keywords or 'trading' in keywords:
        name = "Stock Trading & Investing"
        category = "Finance"
        
    elif 'crypto' in keywords or 'bitcoin' in keywords:
        name = "Cryptocurrency"
        category = "Finance"
        
    elif 'game' in keywords and 'development' in keywords:
        name = "Game Development"
        category = "Programming"
        
    elif 'minecraft' in keywords:
        name = "Minecraft Gaming"
        category = "Gaming"
        
    elif 'fortnite' in keywords:
        name = "Fortnite Gaming"
        category = "Gaming"
        
    else:
        # Generic name based on first few keywords
        name = f"{keywords[0].title()} {keywords[1].title()} Content"
        category = "General"
    
    topic_names.append({
        'topic_id': topic_id,
        'name': name,
        'category': category,
        'size': size,
        'keywords': keywords
    })

# Save results
output = {
    'generated_at': datetime.now().isoformat(),
    'total_topics': len(topics),
    'analyzed': len(topic_names),
    'topics': topic_names
}

with open('topic_names_preview.json', 'w') as f:
    json.dump(output, f, indent=2)

print(f"\n✅ Generated names for {len(topic_names)} topics")
print("Saved to: topic_names_preview.json")

# Show sample
print("\nSample topic names:")
for t in topic_names[:10]:
    print(f"  {t['topic_id']:3d}: {t['name']} ({t['size']} videos)")
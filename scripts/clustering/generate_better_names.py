#!/usr/bin/env python3
"""
Generate better semantic names based on keyword analysis
"""
import json
from datetime import datetime

print("Generating Better Semantic Names")
print("=" * 60)

# Load topics
with open('topic_keywords_final.json', 'r') as f:
    topics = json.load(f)

# Generate names based on keyword patterns
semantic_topics = []

# Mapping based on analysis
name_mappings = {
    # Clear topics from keywords
    0: {"name": "Formula 1 Racing", "category": "Sports", "subcategory": "Motorsports"},
    1: {"name": "Niche Site SEO", "category": "Digital Marketing", "subcategory": "SEO"},
    2: {"name": "Alex Hormozi Business", "category": "Business", "subcategory": "Entrepreneurship"},
    3: {"name": "3D Printing", "category": "Technology", "subcategory": "Manufacturing"},
    4: {"name": "Weight Loss Fitness", "category": "Health", "subcategory": "Fitness"},
    5: {"name": "Metabolic Health", "category": "Health", "subcategory": "Nutrition Science"},
    6: {"name": "Epoxy Resin Tables", "category": "DIY", "subcategory": "Woodworking"},
    7: {"name": "Lo-Fi Music Production", "category": "Music", "subcategory": "Production"},
    8: {"name": "Music Interviews", "category": "Entertainment", "subcategory": "Music"},
    9: {"name": "LEGO Reviews", "category": "Hobbies", "subcategory": "LEGO"},
    10: {"name": "US Geography", "category": "Education", "subcategory": "Geography"},
    11: {"name": "Sailing Adventures", "category": "Lifestyle", "subcategory": "Sailing"},
    12: {"name": "Excel & Power BI", "category": "Technology", "subcategory": "Data Analysis"},
    13: {"name": "FPV Drone Racing", "category": "Technology", "subcategory": "Drones"},
    14: {"name": "Film & VFX", "category": "Creative", "subcategory": "Film Production"},
    15: {"name": "Machining Tutorial", "category": "DIY", "subcategory": "Metalworking"},
    16: {"name": "Medical Reactions", "category": "Education", "subcategory": "Medical"},
    17: {"name": "Adam Savage's Tested", "category": "DIY", "subcategory": "Making"},
    18: {"name": "Rob Scallon Music", "category": "Music", "subcategory": "Guitar"},
    19: {"name": "History Timeline", "category": "Education", "subcategory": "History"},
}

# Process all topics
for topic in topics:
    topic_id = topic['topic_id']
    keywords = topic['keywords']
    size = topic['size']
    
    if topic_id in name_mappings:
        # Use manual mapping
        semantic_name = name_mappings[topic_id]['name']
        category = name_mappings[topic_id]['category']
        subcategory = name_mappings[topic_id]['subcategory']
    else:
        # Generate based on keywords
        kw_lower = [k.lower() for k in keywords]
        
        # Programming patterns
        if 'python' in kw_lower:
            semantic_name = "Python Programming"
            category = "Programming"
            subcategory = "Python"
        elif 'javascript' in kw_lower or 'js' in kw_lower:
            semantic_name = "JavaScript Development"
            category = "Programming"
            subcategory = "JavaScript"
        elif 'react' in kw_lower:
            semantic_name = "React Development"
            category = "Programming"
            subcategory = "React"
        elif 'css' in kw_lower or 'html' in kw_lower:
            semantic_name = "Web Design"
            category = "Programming"
            subcategory = "Frontend"
        
        # AI/ML patterns
        elif 'machine' in kw_lower and 'learning' in kw_lower:
            semantic_name = "Machine Learning"
            category = "Technology"
            subcategory = "AI/ML"
        elif 'deep' in kw_lower and 'learning' in kw_lower:
            semantic_name = "Deep Learning"
            category = "Technology"
            subcategory = "AI/ML"
        elif 'ai' in kw_lower:
            semantic_name = "Artificial Intelligence"
            category = "Technology"
            subcategory = "AI/ML"
        
        # Gaming patterns
        elif 'minecraft' in kw_lower:
            semantic_name = "Minecraft Gaming"
            category = "Gaming"
            subcategory = "Minecraft"
        elif 'fortnite' in kw_lower:
            semantic_name = "Fortnite Gaming"
            category = "Gaming"
            subcategory = "Fortnite"
        elif 'roblox' in kw_lower:
            semantic_name = "Roblox Gaming"
            category = "Gaming"
            subcategory = "Roblox"
        elif 'game' in kw_lower and 'dev' in kw_lower:
            semantic_name = "Game Development"
            category = "Programming"
            subcategory = "GameDev"
        
        # Finance patterns
        elif 'stock' in kw_lower or 'trading' in kw_lower:
            semantic_name = "Stock Trading"
            category = "Finance"
            subcategory = "Trading"
        elif 'crypto' in kw_lower or 'bitcoin' in kw_lower:
            semantic_name = "Cryptocurrency"
            category = "Finance"
            subcategory = "Crypto"
        elif 'investing' in kw_lower:
            semantic_name = "Investment Strategy"
            category = "Finance"
            subcategory = "Investing"
        
        # Health patterns
        elif 'yoga' in kw_lower:
            semantic_name = "Yoga Practice"
            category = "Health"
            subcategory = "Yoga"
        elif 'meditation' in kw_lower:
            semantic_name = "Meditation"
            category = "Health"
            subcategory = "Mindfulness"
        elif 'workout' in kw_lower or 'exercise' in kw_lower:
            semantic_name = "Workout Routines"
            category = "Health"
            subcategory = "Fitness"
        
        # DIY/Craft patterns
        elif 'diy' in kw_lower:
            semantic_name = "DIY Projects"
            category = "DIY"
            subcategory = "General"
        elif 'woodworking' in kw_lower or 'wood' in kw_lower:
            semantic_name = "Woodworking"
            category = "DIY"
            subcategory = "Woodworking"
        elif 'craft' in kw_lower:
            semantic_name = "Crafts"
            category = "DIY"
            subcategory = "Crafts"
        
        # Default: Create from top keywords
        else:
            # Clean keywords
            clean_kw = [k for k in keywords[:3] if len(k) > 2 and k not in ['the', 'and', 'for', 'with']]
            if len(clean_kw) >= 2:
                semantic_name = f"{clean_kw[0].title()} {clean_kw[1].title()}"
            else:
                semantic_name = keywords[0].title() if keywords else "Topic"
            
            # Guess category
            if any(tech in kw_lower for tech in ['tech', 'computer', 'software', 'app']):
                category = "Technology"
            elif any(edu in kw_lower for edu in ['tutorial', 'learn', 'course', 'how']):
                category = "Education"
            elif any(ent in kw_lower for ent in ['music', 'movie', 'show', 'comedy']):
                category = "Entertainment"
            else:
                category = "General"
            
            subcategory = "Various"
    
    semantic_topics.append({
        'topic_id': topic_id,
        'name': semantic_name,
        'category': category,
        'subcategory': subcategory,
        'size': size,
        'keywords': keywords[:5],
        'tier': 1 if size > 300 else (2 if size > 100 else 3)
    })

# Sort by size for tier assignment
semantic_topics.sort(key=lambda x: x['size'], reverse=True)

# Assign final tiers
for i, topic in enumerate(semantic_topics):
    if i < 30:
        topic['tier'] = 1  # Domain level
        topic['tier_name'] = 'Domain'
    elif i < 250:
        topic['tier'] = 2  # Niche level
        topic['tier_name'] = 'Niche'
    else:
        topic['tier'] = 3  # Topic level
        topic['tier_name'] = 'Topic'

# Save results
output = {
    'generated_at': datetime.now().isoformat(),
    'total_topics': len(semantic_topics),
    'tier_distribution': {
        'tier_1_domains': 30,
        'tier_2_niches': 220,
        'tier_3_topics': len(semantic_topics) - 250
    },
    'topics': semantic_topics
}

with open('semantic_topic_names.json', 'w') as f:
    json.dump(output, f, indent=2)

print(f"✅ Generated semantic names for {len(semantic_topics)} topics")
print("\n📊 Tier Distribution:")
print(f"  Tier 1 (Domains): 30 topics")
print(f"  Tier 2 (Niches): 220 topics")
print(f"  Tier 3 (Topics): {len(semantic_topics) - 250} topics")

# Show top 20 by size
print("\n🏆 Top 20 Topics by Size:")
for topic in semantic_topics[:20]:
    print(f"  {topic['topic_id']:3d}: {topic['name']:30} ({topic['size']} videos) - {topic['category']}")

# Category distribution
categories = {}
for topic in semantic_topics:
    cat = topic['category']
    if cat not in categories:
        categories[cat] = 0
    categories[cat] += topic['size']

print("\n📂 Category Distribution:")
for cat, videos in sorted(categories.items(), key=lambda x: x[1], reverse=True)[:10]:
    print(f"  {cat:20} {videos:6,} videos")
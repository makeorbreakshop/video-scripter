#!/usr/bin/env python3
"""
Analyze topics marked as 'General' to find better categories
"""
import json

print("Analyzing 'General' Category Topics")
print("=" * 60)

# Load semantic names
with open('semantic_topic_names.json', 'r') as f:
    data = json.load(f)

# Load original keywords
with open('topic_keywords_final.json', 'r') as f:
    topics = json.load(f)

# Create keyword lookup
keyword_lookup = {t['topic_id']: t['keywords'] for t in topics}

# Find all General topics
general_topics = [t for t in data['topics'] if t['category'] == 'General']
print(f"\nFound {len(general_topics)} 'General' topics")
print(f"Total videos in General: {sum(t['size'] for t in general_topics):,}")

# Analyze keywords more carefully
print("\n🔍 Analyzing General topics for better categorization...")

better_categories = {}

for topic in general_topics[:50]:  # Sample first 50
    keywords = keyword_lookup.get(topic['topic_id'], [])
    kw_lower = [k.lower() for k in keywords]
    kw_string = ' '.join(kw_lower)
    
    # More specific pattern matching
    if any(cook in kw_string for cook in ['cooking', 'recipe', 'kitchen', 'food', 'chef', 'baking']):
        category = "Food & Cooking"
    elif any(art in kw_string for art in ['painting', 'drawing', 'art', 'sketch', 'artist', 'design']):
        category = "Art & Design"
    elif any(photo in kw_string for photo in ['photography', 'photo', 'camera', 'lens', 'shoot']):
        category = "Photography"
    elif any(auto in kw_string for auto in ['car', 'vehicle', 'automotive', 'mechanic', 'engine']):
        category = "Automotive"
    elif any(beauty in kw_string for beauty in ['makeup', 'beauty', 'skincare', 'hair', 'cosmetic']):
        category = "Beauty & Fashion"
    elif any(pet in kw_string for pet in ['dog', 'cat', 'pet', 'animal', 'puppy', 'kitten']):
        category = "Pets & Animals"
    elif any(travel in kw_string for travel in ['travel', 'trip', 'vacation', 'tourism', 'destination']):
        category = "Travel"
    elif any(sport in kw_string for sport in ['soccer', 'basketball', 'football', 'sports', 'athlete']):
        category = "Sports"
    elif any(real in kw_string for real in ['real estate', 'property', 'house', 'home', 'rental']):
        category = "Real Estate"
    elif any(garden in kw_string for garden in ['garden', 'plant', 'grow', 'farming', 'agriculture']):
        category = "Gardening & Farming"
    elif any(science in kw_string for science in ['science', 'physics', 'chemistry', 'biology', 'research']):
        category = "Science"
    elif any(lang in kw_string for lang in ['language', 'english', 'spanish', 'learn', 'speaking']):
        category = "Language Learning"
    elif any(review in kw_string for review in ['review', 'unboxing', 'gadget', 'product', 'tech']):
        category = "Product Reviews"
    elif any(news in kw_string for news in ['news', 'politics', 'election', 'government', 'policy']):
        category = "News & Politics"
    elif any(religion in kw_string for religion in ['christian', 'bible', 'church', 'prayer', 'god']):
        category = "Religion & Spirituality"
    elif any(parent in kw_string for parent in ['parenting', 'baby', 'kids', 'children', 'family']):
        category = "Parenting & Family"
    elif any(podcast in kw_string for podcast in ['podcast', 'interview', 'talk', 'discussion', 'show']):
        category = "Podcasts & Talk Shows"
    elif any(outdoor in kw_string for outdoor in ['camping', 'hiking', 'outdoor', 'survival', 'bushcraft']):
        category = "Outdoors & Adventure"
    elif any(mil in kw_string for mil in ['military', 'army', 'navy', 'veteran', 'tactical']):
        category = "Military & Defense"
    elif any(law in kw_string for law in ['law', 'legal', 'lawyer', 'court', 'attorney']):
        category = "Law & Legal"
    else:
        # Look at specific keywords
        if keywords:
            first_kw = keywords[0].lower()
            if first_kw in ['guitar', 'piano', 'drums', 'bass', 'violin']:
                category = "Music Education"
            elif first_kw in ['adobe', 'photoshop', 'premiere', 'illustrator']:
                category = "Creative Software"
            elif first_kw in ['marketing', 'seo', 'advertising', 'brand']:
                category = "Marketing"
            elif first_kw in ['fashion', 'style', 'clothing', 'outfit']:
                category = "Fashion"
            else:
                category = "Lifestyle"  # Better than General
        else:
            category = "Misc"
    
    if category not in better_categories:
        better_categories[category] = []
    
    better_categories[category].append({
        'topic_id': topic['topic_id'],
        'name': topic['name'],
        'keywords': keywords[:5],
        'size': topic['size']
    })

print("\n📊 Better Category Distribution:")
for cat, topics in sorted(better_categories.items(), key=lambda x: sum(t['size'] for t in x[1]), reverse=True):
    total_videos = sum(t['size'] for t in topics)
    print(f"\n{cat}: {len(topics)} topics, {total_videos:,} videos")
    # Show examples
    for t in topics[:3]:
        print(f"  - {t['name']} ({t['size']} videos)")
        print(f"    Keywords: {', '.join(t['keywords'][:3])}")

print("\n💡 Recommendations:")
print("1. Replace 'General' with these specific categories")
print("2. Use video titles for even better classification")
print("3. Create subcategories within each main category")
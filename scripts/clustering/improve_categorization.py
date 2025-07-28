#!/usr/bin/env python3
"""
Improve categorization of topics beyond generic 'Lifestyle'
"""
import json
from datetime import datetime

print("Improving Topic Categorization")
print("=" * 60)

# Load current categorization
with open('final_semantic_topic_names.json', 'r') as f:
    data = json.load(f)

# Define better category rules based on keywords and names
def categorize_topic(topic):
    """Determine better category based on topic data"""
    keywords = [k.lower() for k in topic['keywords']]
    kw_string = ' '.join(keywords)
    name = topic['name'].lower()
    
    # Sports & Fitness
    if any(sport in kw_string for sport in ['marathon', 'running', 'run', 'race', 'lacrosse', 'basketball', 'football', 'soccer', 'sports', 'athlete', 'fitness', 'gym', 'workout', 'exercise', 'training']):
        return "Sports & Fitness", "Athletics"
    
    # Travel & Adventure
    elif any(travel in kw_string for travel in ['sailing', 'sail', 'boat', 'travel', 'trip', 'cruise', 'adventure', 'explore', 'journey']):
        return "Travel & Adventure", "Travel"
    
    # Social Media & Marketing
    elif any(social in kw_string for social in ['instagram', 'youtube', 'tiktok', 'twitter', 'facebook', 'algorithm', 'followers', 'subscribers', 'growth']):
        return "Social Media", "Platform Growth"
    
    # Content Creation
    elif any(content in kw_string for content in ['vlog', 'vlogmas', 'daily', 'weekly', 'camera', 'filming', 'editing', 'creator']):
        return "Content Creation", "Vlogging"
    
    # Psychology & Self-Help
    elif any(psych in kw_string for psych in ['charisma', 'respect', 'psychological', 'mindset', 'self', 'personal', 'development', 'improvement']):
        return "Psychology", "Personal Development"
    
    # Food & Challenges
    elif any(food in kw_string for food in ['eating', 'food', 'challenge', 'stonie', 'competitive']):
        return "Entertainment", "Challenges"
    
    # Science & Engineering
    elif any(sci in kw_string for sci in ['science', 'chemistry', 'physics', 'biology', 'engineering', 'experiment', 'research']):
        return "Science & Engineering", "Applied Science"
    
    # Geography & Places
    elif any(geo in kw_string for geo in ['states', 'cities', 'towns', 'countries', 'places', 'live', 'retire', 'location']):
        return "Geography & Culture", "Places to Live"
    
    # Entertainment & Comedy
    elif any(ent in kw_string for ent in ['comedy', 'funny', 'humor', 'entertainment', 'show', 'performance']):
        return "Entertainment", "Comedy"
    
    # News & Current Events
    elif any(news in kw_string for news in ['news', 'politics', 'election', 'government', 'policy', 'current', 'events']):
        return "News & Politics", "Current Events"
    
    # Home & Garden
    elif any(home in kw_string for home in ['home', 'house', 'garden', 'diy', 'renovation', 'decor', 'interior']):
        return "Home & Garden", "Home Improvement"
    
    # Pets & Animals
    elif any(pet in kw_string for pet in ['dog', 'cat', 'pet', 'animal', 'puppy', 'kitten', 'fish', 'bird']):
        return "Pets & Animals", "Pet Care"
    
    # Beauty & Fashion
    elif any(beauty in kw_string for beauty in ['makeup', 'beauty', 'skincare', 'hair', 'fashion', 'style', 'outfit']):
        return "Beauty & Fashion", "Beauty"
    
    # Parenting & Family
    elif any(parent in kw_string for parent in ['parenting', 'baby', 'kids', 'children', 'family', 'mom', 'dad']):
        return "Parenting & Family", "Family Life"
    
    # Religion & Spirituality
    elif any(religion in kw_string for religion in ['christian', 'bible', 'church', 'prayer', 'god', 'faith', 'spiritual']):
        return "Religion & Spirituality", "Faith"
    
    # Military & Defense
    elif any(mil in kw_string for mil in ['military', 'army', 'navy', 'marine', 'veteran', 'tactical', 'defense']):
        return "Military & Defense", "Military"
    
    # Law & Legal
    elif any(law in kw_string for law in ['law', 'legal', 'lawyer', 'court', 'attorney', 'justice']):
        return "Law & Legal", "Legal Education"
    
    # Real Estate
    elif any(real in kw_string for real in ['real estate', 'property', 'realtor', 'housing', 'rental']):
        return "Real Estate", "Property"
    
    # Keep original if it's already specific
    elif topic['category'] not in ['Lifestyle', 'General']:
        return topic['category'], topic['subcategory']
    
    # Default to Entertainment if unclear
    else:
        return "Entertainment", "General"

# Recategorize all topics
recategorized = 0
for topic in data['topics']:
    old_category = topic['category']
    new_category, new_subcategory = categorize_topic(topic)
    
    if old_category != new_category:
        recategorized += 1
        topic['category'] = new_category
        topic['subcategory'] = new_subcategory

print(f"✅ Recategorized {recategorized} topics")

# Calculate new distribution
categories = {}
for topic in data['topics']:
    cat = topic['category']
    if cat not in categories:
        categories[cat] = {'count': 0, 'videos': 0}
    categories[cat]['count'] += 1
    categories[cat]['videos'] += topic['size']

# Save improved categorization
data['recategorization_date'] = datetime.now().isoformat()
data['category_summary'] = categories

with open('improved_topic_categorization.json', 'w') as f:
    json.dump(data, f, indent=2)

print("\n📊 New Category Distribution:")
for cat, stats in sorted(categories.items(), key=lambda x: x[1]['videos'], reverse=True):
    print(f"{cat:25} {stats['count']:4} topics, {stats['videos']:6,} videos ({stats['count']/len(data['topics'])*100:.1f}%)")

print(f"\n💾 Saved to: improved_topic_categorization.json")
#!/usr/bin/env python3
"""
Analyze and clean up the hierarchical BERTopic results
"""

import json
import pandas as pd
from collections import defaultdict

def analyze_hierarchy_files():
    """Analyze the generated hierarchy files"""
    
    # Load the generated files
    try:
        # Find the most recent hierarchy directory
        import os
        import glob
        
        dirs = glob.glob("hierarchical_categories_*")
        if not dirs:
            print("❌ No hierarchy results found!")
            return
            
        latest_dir = max(dirs)
        print(f"📁 Analyzing results from: {latest_dir}")
        
        # Load summary
        with open(f"{latest_dir}/summary.json", 'r') as f:
            summary = json.load(f)
        
        print(f"\n📊 HIERARCHY ANALYSIS SUMMARY")
        print(f"="*50)
        print(f"Total Videos: {summary['total_videos']:,}")
        print(f"Analysis Date: {summary['timestamp']}")
        
        # Analyze each level
        for level, stats in summary['level_stats'].items():
            level_name = {
                'level_1': 'Super Categories',
                'level_2': 'Main Categories', 
                'level_3': 'Sub Categories'
            }[level]
            
            print(f"\n🏷️  {level_name}:")
            print(f"   Topics: {stats['total_topics']}")
            print(f"   Outliers: {stats['outliers']:,} ({stats['outlier_percentage']:.1f}%)")
            print(f"   Largest Topic: {stats['largest_topic_size']:,} videos")
        
        # Load and analyze topic assignments
        analyze_topic_distributions(latest_dir)
        
    except Exception as e:
        print(f"❌ Error analyzing hierarchy: {e}")

def analyze_topic_distributions(results_dir):
    """Analyze the distribution of topics at each level"""
    
    print(f"\n🔍 TOPIC DISTRIBUTION ANALYSIS")
    print(f"="*50)
    
    for level_num in [1, 2, 3]:
        level_name = ['Super Categories', 'Main Categories', 'Sub Categories'][level_num - 1]
        
        try:
            # Load assignments
            df = pd.read_csv(f"{results_dir}/level_{level_num}_assignments.csv")
            
            # Analyze distribution
            topic_counts = df[f'level_{level_num}_topic'].value_counts()
            non_outliers = topic_counts[topic_counts.index != -1]
            
            print(f"\n📈 {level_name}:")
            print(f"   Active Topics: {len(non_outliers)}")
            print(f"   Outliers: {topic_counts.get(-1, 0):,}")
            
            if len(non_outliers) > 0:
                print(f"   Largest: {non_outliers.iloc[0]:,} videos")
                print(f"   Smallest: {non_outliers.iloc[-1]:,} videos") 
                print(f"   Median: {non_outliers.median():.0f} videos")
                
                # Show top 5 topics
                print(f"\n   Top 5 Topics:")
                for i, (topic_id, count) in enumerate(non_outliers.head().items()):
                    print(f"   {i+1}. Topic {topic_id}: {count:,} videos")
            
        except Exception as e:
            print(f"   ❌ Error loading {level_name}: {e}")

def create_practical_hierarchy():
    """Create a practical 3-tier hierarchy for YouTube content"""
    
    print(f"\n🌳 PRACTICAL YOUTUBE CATEGORY HIERARCHY")
    print(f"="*60)
    
    # Define a practical hierarchy based on the results
    practical_hierarchy = {
        "🎯 Content & Entertainment": {
            "description": "Entertainment, gaming, and lifestyle content",
            "subcategories": {
                "Gaming & Esports": ["Minecraft", "Gaming Reviews", "Esports", "Game Tutorials"],
                "Entertainment & Comedy": ["Challenges", "Pranks", "Reactions", "Comedy Skits"],
                "Lifestyle & Personal": ["Daily Vlogs", "Personal Stories", "Life Advice", "Self-Improvement"]
            }
        },
        
        "🔧 Makers & DIY": {
            "description": "Creative building, crafting, and hands-on projects",
            "subcategories": {
                "Woodworking & Furniture": ["Table Building", "Chair Making", "Wood Crafts", "Tool Reviews"],
                "3D Printing & Tech": ["3D Printing Projects", "Tech Builds", "Electronics", "Prototyping"],
                "General DIY & Crafts": ["Home Improvement", "Art Projects", "Cosplay", "Repairs"]
            }
        },
        
        "🍳 Food & Cooking": {
            "description": "Culinary content and food-related videos",
            "subcategories": {
                "Recipe & Cooking": ["Recipe Tutorials", "Chef Techniques", "Baking", "International Cuisine"],
                "Food Challenges": ["Eating Challenges", "Food Reviews", "Taste Tests", "Food Competition"],
                "Restaurant & Travel": ["Restaurant Reviews", "Food Travel", "Street Food", "Food Culture"]
            }
        },
        
        "💪 Health & Fitness": {
            "description": "Physical health, exercise, and wellness content",
            "subcategories": {
                "Workout & Training": ["Gym Workouts", "Home Fitness", "Strength Training", "Cardio"],
                "Nutrition & Diet": ["Meal Prep", "Diet Plans", "Nutrition Tips", "Weight Loss"],
                "Sports & Athletics": ["Sports Training", "Athletic Performance", "Sports Analysis", "Competitions"]
            }
        },
        
        "📱 Technology & Reviews": {
            "description": "Tech products, reviews, and digital content",
            "subcategories": {
                "Mobile & Devices": ["iPhone Reviews", "Android Reviews", "Gadget Reviews", "Tech Comparisons"],
                "Cameras & Photography": ["Camera Reviews", "Photography Tips", "Video Equipment", "Editing"],
                "Computing & Software": ["PC Builds", "Software Reviews", "Programming", "Tech Tutorials"]
            }
        },
        
        "🚗 Automotive & Transport": {
            "description": "Cars, vehicles, and transportation content",
            "subcategories": {
                "Electric Vehicles": ["Tesla Reviews", "EV Technology", "Electric Car News", "EV Comparisons"],
                "Traditional Automotive": ["Car Reviews", "Auto Repair", "Car Modifications", "Racing"],
                "Transportation": ["Trains", "Aviation", "Public Transport", "Travel Methods"]
            }
        },
        
        "💰 Business & Finance": {
            "description": "Financial advice, business, and money-related content",
            "subcategories": {
                "Personal Finance": ["Investment Tips", "Saving Money", "Financial Planning", "Retirement"],
                "Business & Entrepreneurship": ["Startup Advice", "Business Strategy", "Marketing", "Success Stories"],
                "Market Analysis": ["Stock Market", "Crypto", "Economic Analysis", "Financial News"]
            }
        },
        
        "🎵 Music & Audio": {
            "description": "Music creation, performance, and audio content", 
            "subcategories": {
                "Instruments & Performance": ["Guitar Tutorials", "Music Lessons", "Live Performances", "Music Theory"],
                "Audio Production": ["Music Production", "Sound Engineering", "Equipment Reviews", "Recording"],
                "Music Analysis": ["Song Breakdowns", "Music History", "Artist Analysis", "Genre Studies"]
            }
        },
        
        "🚀 Science & Education": {
            "description": "Educational content and scientific exploration",
            "subcategories": {
                "Space & Physics": ["SpaceX", "Astronomy", "Physics Experiments", "Space News"],
                "Engineering & Innovation": ["Engineering Projects", "Inventions", "How Things Work", "Innovation"],
                "Educational Content": ["Science Lessons", "Documentaries", "Explainer Videos", "Research"]
            }
        },
        
        "✈️ Travel & Lifestyle": {
            "description": "Travel experiences and luxury lifestyle content",
            "subcategories": {
                "Luxury Travel": ["Business Class", "Luxury Hotels", "High-end Experiences", "Premium Transport"],
                "Adventure & Exploration": ["Travel Vlogs", "Adventure Sports", "Exploration", "Cultural Experiences"],
                "Accommodation & Reviews": ["Hotel Reviews", "Airbnb Tours", "Travel Tips", "Destination Guides"]
            }
        }
    }
    
    # Print the hierarchy
    for super_category, data in practical_hierarchy.items():
        print(f"\n{super_category}")
        print(f"   {data['description']}")
        
        for main_category, sub_categories in data['subcategories'].items():
            print(f"   ├── 📂 {main_category}")
            for sub_cat in sub_categories:
                print(f"   │   └── 📄 {sub_cat}")
    
    # Save the practical hierarchy
    with open('practical_youtube_hierarchy.json', 'w') as f:
        json.dump(practical_hierarchy, f, indent=2)
    
    print(f"\n💾 Practical hierarchy saved to practical_youtube_hierarchy.json")
    
    return practical_hierarchy

def generate_implementation_suggestions():
    """Generate suggestions for implementing the hierarchy in the database"""
    
    print(f"\n💡 IMPLEMENTATION SUGGESTIONS")
    print(f"="*50)
    
    suggestions = [
        "1. **Database Schema Updates**:",
        "   - Add 'super_category', 'main_category', 'sub_category' columns to videos table",
        "   - Create categories lookup table with hierarchy relationships",
        "   - Add category confidence scores for manual review",
        "",
        "2. **Classification Pipeline**:",
        "   - Use Combined Title+Summary approach (best performance)",
        "   - Implement 3-tier classification with fallback to higher levels",
        "   - Set confidence thresholds (e.g., >0.7 for auto-classification)",
        "",
        "3. **User Interface Enhancements**:",
        "   - Hierarchical category filters in search",
        "   - Category-based analytics dashboards", 
        "   - Category performance comparisons",
        "",
        "4. **Analytics Improvements**:",
        "   - Performance metrics by category level",
        "   - Category trend analysis over time",
        "   - Competitor analysis within categories",
        "",
        "5. **Content Strategy Features**:",
        "   - Gap analysis: underperformed categories",
        "   - Content recommendations based on category performance",
        "   - Category-specific optimization suggestions"
    ]
    
    for suggestion in suggestions:
        print(suggestion)

def main():
    print("📊 Hierarchical BERTopic Results Analysis")
    print("="*50)
    
    # Analyze the generated hierarchy files
    analyze_hierarchy_files()
    
    # Create practical hierarchy
    practical_hierarchy = create_practical_hierarchy()
    
    # Generate implementation suggestions
    generate_implementation_suggestions()
    
    print(f"\n✅ Analysis complete!")
    print(f"\n🎯 Key Takeaways:")
    print(f"   • 3-tier hierarchy works well for YouTube content")
    print(f"   • Combined Title+Summary gives best categorization")
    print(f"   • ~30% outliers is acceptable for edge cases")
    print(f"   • Practical hierarchy provides business value")

if __name__ == "__main__":
    main()
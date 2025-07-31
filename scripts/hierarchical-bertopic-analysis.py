#!/usr/bin/env python3
"""
Hierarchical BERTopic Clustering: Multi-level category system
Creates a 3-tier hierarchy: Super Categories -> Main Categories -> Sub Categories
"""

import json
import numpy as np
import pandas as pd
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer
from sentence_transformers import SentenceTransformer
from datetime import datetime
import os
from collections import Counter, defaultdict

def load_data(filename):
    """Load data from JSON file"""
    print(f"📥 Loading data from {filename}...")
    
    with open(filename, 'r') as f:
        data = json.load(f)
    
    videos = pd.DataFrame(data['videos'])
    text_vars = data['text_variations']
    
    print(f"✅ Loaded {len(videos)} videos")
    return videos, text_vars['combined']  # Use combined approach

def create_hierarchical_topics(texts, videos_df, levels=[100, 50, 25]):
    """Create hierarchical topic structure with different granularity levels"""
    print(f"\n🏗️  Creating Hierarchical Topic Structure")
    print(f"Level 1 (Super Categories): ~{levels[0]} min topic size")
    print(f"Level 2 (Main Categories): ~{levels[1]} min topic size") 
    print(f"Level 3 (Sub Categories): ~{levels[2]} min topic size")
    
    hierarchical_results = {}
    
    # Level 1: Super Categories (broad, high-level)
    print(f"\n{'='*50}")
    print(f"🌍 Level 1: Super Categories")
    print(f"{'='*50}")
    
    model_l1, topics_l1, info_l1 = run_bertopic_clustering(
        texts, "Level 1 - Super Categories", min_topic_size=levels[0]
    )
    hierarchical_results['level_1'] = {
        'model': model_l1,
        'topics': topics_l1,
        'info': info_l1,
        'name': 'Super Categories'
    }
    
    # Level 2: Main Categories (medium granularity)
    print(f"\n{'='*50}")
    print(f"🏢 Level 2: Main Categories")
    print(f"{'='*50}")
    
    model_l2, topics_l2, info_l2 = run_bertopic_clustering(
        texts, "Level 2 - Main Categories", min_topic_size=levels[1]
    )
    hierarchical_results['level_2'] = {
        'model': model_l2,
        'topics': topics_l2,
        'info': info_l2,
        'name': 'Main Categories'
    }
    
    # Level 3: Sub Categories (fine-grained)
    print(f"\n{'='*50}")
    print(f"🔬 Level 3: Sub Categories")
    print(f"{'='*50}")
    
    model_l3, topics_l3, info_l3 = run_bertopic_clustering(
        texts, "Level 3 - Sub Categories", min_topic_size=levels[2]
    )
    hierarchical_results['level_3'] = {
        'model': model_l3,
        'topics': topics_l3,
        'info': info_l3,
        'name': 'Sub Categories'
    }
    
    return hierarchical_results

def run_bertopic_clustering(texts, name, min_topic_size=50):
    """Run BERTopic clustering with specified parameters"""
    print(f"🧠 Processing {len(texts)} documents for {name}...")
    
    # Use lightweight model for speed
    sentence_model = SentenceTransformer("all-MiniLM-L6-v2")
    
    # Vectorizer optimized for hierarchy level
    vectorizer = CountVectorizer(
        ngram_range=(1, 2),
        stop_words="english",
        min_df=max(2, min_topic_size // 10),  # Adaptive min_df
        max_df=0.9,
        max_features=1000
    )
    
    # Create BERTopic model
    topic_model = BERTopic(
        embedding_model=sentence_model,
        vectorizer_model=vectorizer,
        min_topic_size=min_topic_size,
        verbose=True,
        calculate_probabilities=False
    )
    
    topics, _ = topic_model.fit_transform(texts)
    topic_info = topic_model.get_topic_info()
    outliers = sum(1 for t in topics if t == -1)
    
    print(f"✅ {name} Results:")
    print(f"   - Topics: {len(topic_info) - 1}")
    print(f"   - Outliers: {outliers} ({outliers/len(topics)*100:.1f}%)")
    
    return topic_model, topics, topic_info

def analyze_hierarchy_relationships(hierarchical_results, videos_df):
    """Analyze relationships between different hierarchy levels"""
    print(f"\n🔗 Analyzing Hierarchy Relationships...")
    
    # Create master dataframe with all levels
    analysis_df = videos_df.copy()
    
    for level, data in hierarchical_results.items():
        analysis_df[f'{level}_topic'] = data['topics']
    
    # Create hierarchy mapping
    hierarchy_map = defaultdict(lambda: defaultdict(set))
    
    for _, row in analysis_df.iterrows():
        l1_topic = row['level_1_topic']
        l2_topic = row['level_2_topic'] 
        l3_topic = row['level_3_topic']
        
        if l1_topic != -1 and l2_topic != -1:
            hierarchy_map[l1_topic][l2_topic].add(l3_topic)
    
    return analysis_df, hierarchy_map

def create_semantic_hierarchy_names(hierarchical_results):
    """Create semantic names for hierarchy levels"""
    print(f"\n🏷️  Creating Semantic Category Names...")
    
    semantic_hierarchy = {}
    
    for level, data in hierarchical_results.items():
        model = data['model']
        topic_info = data['info']
        semantic_hierarchy[level] = {}
        
        print(f"\n{data['name']}:")
        
        for i in range(min(10, len(topic_info) - 1)):  # Top 10 topics
            topic_id = topic_info.iloc[i+1]['Topic']  # Skip outliers
            topic_words = model.get_topic(topic_id)
            count = topic_info.iloc[i+1]['Count']
            
            # Create semantic name from top words
            top_words = [word for word, _ in topic_words[:3]]
            semantic_name = create_category_name(top_words)
            
            semantic_hierarchy[level][topic_id] = {
                'name': semantic_name,
                'words': [word for word, _ in topic_words[:5]],
                'count': count
            }
            
            print(f"   Topic {topic_id}: {semantic_name} ({count} videos)")
            print(f"     Keywords: {', '.join(top_words)}")
    
    return semantic_hierarchy

def create_category_name(words):
    """Create human-readable category name from topic words"""
    # Category mapping rules
    category_mappings = {
        # Tech categories
        ('iphone', 'apple', 'pro'): 'Apple Products',
        ('car', 'tesla', 'electric'): 'Electric Vehicles',
        ('phone', 'samsung', 'galaxy'): 'Android Devices',
        ('camera', 'sony', 'lens'): 'Photography Equipment',
        ('gaming', 'pc', 'setup'): 'Gaming Hardware',
        
        # Content categories  
        ('cooking', 'food', 'chef'): 'Cooking & Food',
        ('workout', 'fitness', 'training'): 'Fitness & Exercise',
        ('woodworking', 'table', 'wood'): 'Woodworking & DIY',
        ('music', 'guitar', 'song'): 'Music & Instruments',
        ('art', 'painting', 'drawing'): 'Art & Creative',
        
        # Lifestyle categories
        ('travel', 'class', 'flight'): 'Travel & Luxury',
        ('money', 'business', 'investment'): 'Finance & Business', 
        ('house', 'home', 'design'): 'Home & Design',
        ('space', 'rocket', 'nasa'): 'Space & Science',
        
        # Entertainment
        ('minecraft', 'game', 'gaming'): 'Gaming Content',
        ('youtube', 'channel', 'video'): 'YouTube Meta',
        ('slow', 'motion', 'guys'): 'Slow Motion Content',
    }
    
    # Check for exact matches
    words_tuple = tuple(sorted(words[:3]))
    for key_words, category in category_mappings.items():
        if all(word in words for word in key_words):
            return category
    
    # Fallback: capitalize and join
    return ' & '.join(word.title() for word in words[:2])

def create_hierarchy_structure(analysis_df, semantic_hierarchy, hierarchy_map):
    """Create final hierarchical structure"""
    print(f"\n🌳 Building Final Hierarchy Structure...")
    
    structure = {
        'metadata': {
            'total_videos': len(analysis_df),
            'timestamp': datetime.now().isoformat(),
            'levels': 3
        },
        'hierarchy': {}
    }
    
    # Build the tree structure
    for l1_topic, l2_topics in hierarchy_map.items():
        if l1_topic == -1:
            continue
            
        l1_info = semantic_hierarchy['level_1'].get(l1_topic, {})
        l1_name = l1_info.get('name', f'Category {l1_topic}')
        
        structure['hierarchy'][l1_topic] = {
            'id': l1_topic,
            'name': l1_name,
            'level': 1,
            'keywords': l1_info.get('words', []),
            'video_count': l1_info.get('count', 0),
            'subcategories': {}
        }
        
        for l2_topic, l3_topics in l2_topics.items():
            if l2_topic == -1:
                continue
                
            l2_info = semantic_hierarchy['level_2'].get(l2_topic, {})
            l2_name = l2_info.get('name', f'Subcategory {l2_topic}')
            
            structure['hierarchy'][l1_topic]['subcategories'][l2_topic] = {
                'id': l2_topic,
                'name': l2_name,
                'level': 2, 
                'keywords': l2_info.get('words', []),
                'video_count': l2_info.get('count', 0),
                'subcategories': {}
            }
            
            for l3_topic in l3_topics:
                if l3_topic == -1:
                    continue
                    
                l3_info = semantic_hierarchy['level_3'].get(l3_topic, {})
                l3_name = l3_info.get('name', f'Subcategory {l3_topic}')
                
                structure['hierarchy'][l1_topic]['subcategories'][l2_topic]['subcategories'][l3_topic] = {
                    'id': l3_topic,
                    'name': l3_name, 
                    'level': 3,
                    'keywords': l3_info.get('words', []),
                    'video_count': l3_info.get('count', 0)
                }
    
    return structure

def save_hierarchical_results(hierarchical_results, analysis_df, hierarchy_structure):
    """Save all hierarchical results"""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    output_dir = f"hierarchical_categories_{timestamp}"
    os.makedirs(output_dir, exist_ok=True)
    
    # Save the complete hierarchy structure
    with open(f"{output_dir}/hierarchy_structure.json", 'w') as f:
        json.dump(hierarchy_structure, f, indent=2)
    
    # Save video assignments for each level
    for level in ['level_1', 'level_2', 'level_3']:
        level_df = analysis_df[['id', 'title', 'channel_name', f'{level}_topic']].copy()
        level_df.to_csv(f"{output_dir}/{level}_assignments.csv", index=False)
    
    # Save topic info for each level
    for level, data in hierarchical_results.items():
        data['info'].to_csv(f"{output_dir}/{level}_topics.csv", index=False)
    
    # Create summary report
    summary = {
        'timestamp': timestamp,
        'total_videos': len(analysis_df),
        'hierarchy_levels': 3,
        'level_stats': {}
    }
    
    for level, data in hierarchical_results.items():
        topics = data['topics']
        info = data['info']
        
        summary['level_stats'][level] = {
            'total_topics': len(info) - 1,
            'outliers': sum(1 for t in topics if t == -1),
            'outlier_percentage': sum(1 for t in topics if t == -1) / len(topics) * 100,
            'largest_topic_size': info.iloc[1]['Count'] if len(info) > 1 else 0
        }
    
    with open(f"{output_dir}/summary.json", 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"\n💾 Results saved to {output_dir}/")
    return output_dir

def print_hierarchy_preview(hierarchy_structure):
    """Print a preview of the hierarchy structure"""
    print(f"\n🌳 HIERARCHICAL CATEGORY STRUCTURE PREVIEW")
    print(f"{'='*60}")
    
    hierarchy = hierarchy_structure['hierarchy']
    
    for l1_id, l1_data in list(hierarchy.items())[:5]:  # Show top 5 super categories
        print(f"\n📁 {l1_data['name']} ({l1_data['video_count']} videos)")
        print(f"   Keywords: {', '.join(l1_data['keywords'][:3])}")
        
        for l2_id, l2_data in list(l1_data['subcategories'].items())[:3]:  # Top 3 main categories
            print(f"   ├── 📂 {l2_data['name']} ({l2_data['video_count']} videos)")
            
            for l3_id, l3_data in list(l2_data['subcategories'].items())[:2]:  # Top 2 sub categories
                print(f"   │   └── 📄 {l3_data['name']} ({l3_data['video_count']} videos)")
    
    print(f"\n📊 Total Structure:")
    print(f"   Super Categories: {len(hierarchy)}")
    print(f"   Main Categories: {sum(len(l1['subcategories']) for l1 in hierarchy.values())}")
    print(f"   Sub Categories: {sum(len(l2['subcategories']) for l1 in hierarchy.values() for l2 in l1['subcategories'].values())}")

def main():
    print("🌳 Hierarchical BERTopic Category Analysis")
    print("="*60)
    
    # Load data
    data_file = "bertopic_data_2025-07-30.json"
    if not os.path.exists(data_file):
        print(f"❌ Data file {data_file} not found!")
        return
    
    videos_df, combined_texts = load_data(data_file)
    
    # Create hierarchical topic structure
    hierarchical_results = create_hierarchical_topics(
        combined_texts, 
        videos_df,
        levels=[100, 50, 25]  # Adjust these for different granularity
    )
    
    # Analyze relationships between levels
    analysis_df, hierarchy_map = analyze_hierarchy_relationships(hierarchical_results, videos_df)
    
    # Create semantic names
    semantic_hierarchy = create_semantic_hierarchy_names(hierarchical_results)
    
    # Build final structure
    hierarchy_structure = create_hierarchy_structure(analysis_df, semantic_hierarchy, hierarchy_map)
    
    # Print preview
    print_hierarchy_preview(hierarchy_structure)
    
    # Save results
    output_dir = save_hierarchical_results(hierarchical_results, analysis_df, hierarchy_structure)
    
    print(f"\n✅ Hierarchical analysis complete!")
    print(f"📊 Check {output_dir}/ for detailed results")
    print(f"\n💡 Key files:")
    print(f"   - hierarchy_structure.json: Complete category tree")
    print(f"   - level_X_assignments.csv: Video assignments per level")
    print(f"   - summary.json: Overview statistics")

if __name__ == "__main__":
    main()
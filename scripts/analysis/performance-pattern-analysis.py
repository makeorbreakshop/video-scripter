#!/usr/bin/env python3
"""
Phase 2: Performance Pattern Discovery Engine
Identifies success patterns independent of content topic using feature engineering,
association rule mining, and predictive modeling.

This script will:
1. Load video data with titles, thumbnails, metadata, and performance metrics
2. Extract features from titles (length, keywords, sentiment, structure)
3. Extract features from thumbnails (visual patterns, colors, faces)
4. Engineer metadata features (timing, duration, publication patterns)
5. Apply association rule mining to discover performance patterns
6. Generate actionable performance rules and "performance recipes"
"""

import pandas as pd
import numpy as np
import re
import json
import pickle
import csv
from datetime import datetime
from collections import Counter
import matplotlib.pyplot as plt
import seaborn as sns

# Feature engineering libraries
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.inspection import permutation_importance

# Association rule mining
from mlxtend.frequent_patterns import apriori, association_rules
from mlxtend.preprocessing import TransactionEncoder

# Text analysis
import nltk
from nltk.sentiment import SentimentIntensityAnalyzer
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize
from nltk.stem import WordNetLemmatizer

# Download required NLTK data
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')

try:
    nltk.data.find('corpora/stopwords')
except LookupError:
    nltk.download('stopwords')

try:
    nltk.data.find('corpora/wordnet')
except LookupError:
    nltk.download('wordnet')

try:
    nltk.data.find('vader_lexicon')
except LookupError:
    nltk.download('vader_lexicon')

class PerformancePatternAnalyzer:
    def __init__(self, title_embeddings_path=None, thumbnail_embeddings_path=None):
        """Initialize with paths to embedding data"""
        self.title_embeddings_path = title_embeddings_path
        self.thumbnail_embeddings_path = thumbnail_embeddings_path
        self.df = None
        self.features_df = None
        self.performance_rules = []
        self.model = None
        self.feature_importance = None
        
        # Initialize NLTK components
        self.sia = SentimentIntensityAnalyzer()
        self.lemmatizer = WordNetLemmatizer()
        self.stop_words = set(stopwords.words('english'))
        
    def load_data(self):
        """Load and merge title embeddings with performance data"""
        print("📊 Loading performance data...")
        
        # Load CSV with custom parser (same as BERTopic script)
        rows = []
        with open(self.title_embeddings_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, quotechar='"', doublequote=True)
            headers = next(reader)
            for row in reader:
                if len(row) == 6:  # Expected number of columns
                    rows.append(row)
                else:
                    print(f"   Skipping malformed row with {len(row)} columns")
        
        # Convert to DataFrame
        self.df = pd.DataFrame(rows, columns=headers)
        print(f"   Loaded {len(self.df)} videos with title data")
        
        # Convert data types
        self.df['view_count'] = pd.to_numeric(self.df['view_count'], errors='coerce')
        self.df['performance_ratio'] = pd.to_numeric(self.df['performance_ratio'], errors='coerce')
        
        # Remove rows with missing performance data
        initial_count = len(self.df)
        self.df = self.df.dropna(subset=['performance_ratio', 'view_count'])
        print(f"   Filtered to {len(self.df)} videos with valid performance data")
        print(f"   Removed {initial_count - len(self.df)} videos with missing data")
        
        # Basic statistics
        print("\n📈 Performance Statistics:")
        print(f"   Average performance ratio: {self.df['performance_ratio'].mean():.3f}")
        print(f"   Median performance ratio: {self.df['performance_ratio'].median():.3f}")
        print(f"   Top 10% threshold: {self.df['performance_ratio'].quantile(0.9):.3f}")
        print(f"   Bottom 10% threshold: {self.df['performance_ratio'].quantile(0.1):.3f}")
        
        return self.df
    
    def extract_title_features(self):
        """Extract comprehensive features from video titles"""
        print("\n🔍 Extracting title features...")
        
        features = []
        
        for idx, row in self.df.iterrows():
            title = str(row['title'])
            
            # Basic text features
            title_features = {
                'title_length': len(title),
                'word_count': len(title.split()),
                'char_count': len(title),
                'avg_word_length': np.mean([len(word) for word in title.split()]) if title.split() else 0,
                'uppercase_ratio': sum(1 for c in title if c.isupper()) / len(title) if title else 0,
                'digit_count': sum(1 for c in title if c.isdigit()),
                'punctuation_count': sum(1 for c in title if c in '!?.,;:'),
                'exclamation_count': title.count('!'),
                'question_count': title.count('?'),
            }
            
            # Sentiment analysis
            sentiment_scores = self.sia.polarity_scores(title)
            title_features.update({
                'sentiment_compound': sentiment_scores['compound'],
                'sentiment_positive': sentiment_scores['pos'],
                'sentiment_negative': sentiment_scores['neg'],
                'sentiment_neutral': sentiment_scores['neu'],
            })
            
            # Structural patterns
            title_features.update({
                'has_numbers': bool(re.search(r'\d', title)),
                'has_parentheses': '(' in title and ')' in title,
                'has_brackets': '[' in title and ']' in title,
                'has_quotes': '"' in title or "'" in title,
                'has_colon': ':' in title,
                'has_dash': '-' in title,
                'has_pipe': '|' in title,
                'starts_with_number': bool(re.match(r'^\d', title)),
                'ends_with_punctuation': title.endswith(('!', '?', '.')),
            })
            
            # Content patterns
            title_lower = title.lower()
            title_features.update({
                'has_how_to': 'how to' in title_lower,
                'has_diy': 'diy' in title_lower,
                'has_tutorial': 'tutorial' in title_lower,
                'has_guide': 'guide' in title_lower,
                'has_tips': 'tips' in title_lower,
                'has_tricks': 'tricks' in title_lower,
                'has_secrets': 'secrets' in title_lower,
                'has_hack': 'hack' in title_lower,
                'has_easy': 'easy' in title_lower,
                'has_quick': 'quick' in title_lower,
                'has_fast': 'fast' in title_lower,
                'has_simple': 'simple' in title_lower,
                'has_best': 'best' in title_lower,
                'has_ultimate': 'ultimate' in title_lower,
                'has_complete': 'complete' in title_lower,
                'has_perfect': 'perfect' in title_lower,
                'has_amazing': 'amazing' in title_lower,
                'has_incredible': 'incredible' in title_lower,
                'has_must': 'must' in title_lower,
                'has_you': 'you' in title_lower,
                'has_your': 'your' in title_lower,
                'has_why': 'why' in title_lower,
                'has_what': 'what' in title_lower,
                'has_when': 'when' in title_lower,
                'has_where': 'where' in title_lower,
                'has_who': 'who' in title_lower,
                'has_which': 'which' in title_lower,
                'has_review': 'review' in title_lower,
                'has_vs': ' vs ' in title_lower,
                'has_versus': 'versus' in title_lower,
                'has_comparison': 'comparison' in title_lower,
                'has_mistake': 'mistake' in title_lower,
                'has_error': 'error' in title_lower,
                'has_fail': 'fail' in title_lower,
                'has_problem': 'problem' in title_lower,
                'has_solution': 'solution' in title_lower,
                'has_fix': 'fix' in title_lower,
            })
            
            # Time-related patterns
            title_features.update({
                'has_minutes': 'minutes' in title_lower or 'mins' in title_lower,
                'has_hours': 'hours' in title_lower or 'hrs' in title_lower,
                'has_days': 'days' in title_lower,
                'has_week': 'week' in title_lower,
                'has_month': 'month' in title_lower,
                'has_year': 'year' in title_lower,
                'has_2024': '2024' in title,
                'has_2025': '2025' in title,
            })
            
            # Add video metadata
            title_features.update({
                'video_id': row.get('video_id', idx),
                'performance_ratio': row['performance_ratio'],
                'view_count': row['view_count'],
                'channel_name': row.get('channel_name', ''),
            })
            
            features.append(title_features)
        
        self.features_df = pd.DataFrame(features)
        print(f"   Extracted {len(self.features_df.columns)} features from {len(self.features_df)} videos")
        
        return self.features_df
    
    def create_performance_segments(self):
        """Create performance segments for pattern analysis"""
        print("\n📊 Creating performance segments...")
        
        # Define performance thresholds
        high_threshold = self.df['performance_ratio'].quantile(0.8)  # Top 20%
        low_threshold = self.df['performance_ratio'].quantile(0.2)   # Bottom 20%
        
        self.features_df['performance_segment'] = pd.cut(
            self.features_df['performance_ratio'],
            bins=[-np.inf, low_threshold, high_threshold, np.inf],
            labels=['Low', 'Medium', 'High']
        )
        
        segment_counts = self.features_df['performance_segment'].value_counts()
        print(f"   High performers: {segment_counts['High']} videos (>{high_threshold:.3f})")
        print(f"   Medium performers: {segment_counts['Medium']} videos")
        print(f"   Low performers: {segment_counts['Low']} videos (<{low_threshold:.3f})")
        
        return self.features_df
    
    def discover_association_rules(self, min_support=0.1, min_confidence=0.6):
        """Discover association rules between features and performance"""
        print(f"\n🔍 Discovering association rules (min_support={min_support}, min_confidence={min_confidence})...")
        
        # Prepare data for association rule mining
        high_performers = self.features_df[self.features_df['performance_segment'] == 'High']
        
        # Select boolean features for association analysis
        boolean_features = []
        for col in self.features_df.columns:
            if col.startswith('has_') or col in ['starts_with_number', 'ends_with_punctuation']:
                boolean_features.append(col)
        
        # Create transactions (each video is a transaction)
        transactions = []
        for idx, row in high_performers.iterrows():
            transaction = []
            for feature in boolean_features:
                if row[feature]:
                    transaction.append(feature)
            transaction.append('high_performance')  # Target
            transactions.append(transaction)
        
        # Apply TransactionEncoder
        te = TransactionEncoder()
        te_ary = te.fit(transactions).transform(transactions)
        df_encoded = pd.DataFrame(te_ary, columns=te.columns_)
        
        # Find frequent itemsets
        frequent_itemsets = apriori(df_encoded, min_support=min_support, use_colnames=True)
        
        if len(frequent_itemsets) > 0:
            # Generate association rules
            rules = association_rules(frequent_itemsets, metric="confidence", min_threshold=min_confidence)
            
            # Filter rules that predict high performance
            performance_rules = rules[rules['consequents'].apply(lambda x: 'high_performance' in x)]
            
            # Sort by confidence and lift
            performance_rules = performance_rules.sort_values(['confidence', 'lift'], ascending=False)
            
            print(f"   Found {len(performance_rules)} performance rules")
            
            # Display top rules
            for idx, rule in performance_rules.head(10).iterrows():
                antecedents = ', '.join(rule['antecedents'])
                confidence = rule['confidence']
                lift = rule['lift']
                support = rule['support']
                
                print(f"   Rule: {antecedents} → High Performance")
                print(f"      Confidence: {confidence:.3f}, Lift: {lift:.3f}, Support: {support:.3f}")
                print()
            
            self.performance_rules = performance_rules
            return performance_rules
        else:
            print("   No frequent itemsets found. Try lowering min_support.")
            return pd.DataFrame()
    
    def build_predictive_model(self):
        """Build machine learning model to predict performance"""
        print("\n🤖 Building predictive model...")
        
        # Select features for modeling
        feature_columns = []
        for col in self.features_df.columns:
            if col not in ['video_id', 'performance_ratio', 'view_count', 'channel_name', 'performance_segment']:
                feature_columns.append(col)
        
        X = self.features_df[feature_columns]
        y = self.features_df['performance_ratio']
        
        # Handle any remaining non-numeric columns
        for col in X.columns:
            if X[col].dtype == 'object':
                X[col] = X[col].astype('category').cat.codes
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        # Scale features
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        # Train model
        self.model = GradientBoostingRegressor(n_estimators=100, random_state=42)
        self.model.fit(X_train_scaled, y_train)
        
        # Evaluate model
        y_pred = self.model.predict(X_test_scaled)
        mse = mean_squared_error(y_test, y_pred)
        r2 = r2_score(y_test, y_pred)
        
        print(f"   Model Performance:")
        print(f"      MSE: {mse:.4f}")
        print(f"      R²: {r2:.4f}")
        
        # Feature importance
        feature_importance = pd.DataFrame({
            'feature': feature_columns,
            'importance': self.model.feature_importances_
        }).sort_values('importance', ascending=False)
        
        self.feature_importance = feature_importance
        
        print(f"\n   Top 10 Most Important Features:")
        for idx, row in feature_importance.head(10).iterrows():
            print(f"      {row['feature']}: {row['importance']:.4f}")
        
        return self.model, feature_importance
    
    def generate_performance_recipes(self):
        """Generate actionable performance recipes"""
        print("\n🍳 Generating performance recipes...")
        
        recipes = []
        
        # Recipe 1: Based on association rules
        if len(self.performance_rules) > 0:
            for idx, rule in self.performance_rules.head(5).iterrows():
                antecedents = list(rule['antecedents'])
                confidence = rule['confidence']
                lift = rule['lift']
                
                recipe = {
                    'type': 'association_rule',
                    'pattern': antecedents,
                    'confidence': confidence,
                    'lift': lift,
                    'description': f"Videos with {' + '.join(antecedents)} have {confidence:.1%} chance of high performance (lift: {lift:.2f}x)"
                }
                recipes.append(recipe)
        
        # Recipe 2: Based on feature importance
        if self.feature_importance is not None:
            top_features = self.feature_importance.head(5)
            
            for idx, row in top_features.iterrows():
                feature = row['feature']
                importance = row['importance']
                
                # Calculate performance difference
                feature_present = self.features_df[self.features_df[feature] == True]['performance_ratio'].mean()
                feature_absent = self.features_df[self.features_df[feature] == False]['performance_ratio'].mean()
                
                if not pd.isna(feature_present) and not pd.isna(feature_absent):
                    performance_lift = feature_present / feature_absent
                    
                    recipe = {
                        'type': 'feature_importance',
                        'feature': feature,
                        'importance': importance,
                        'performance_lift': performance_lift,
                        'description': f"Videos with '{feature}' perform {performance_lift:.2f}x better on average"
                    }
                    recipes.append(recipe)
        
        # Recipe 3: High-level patterns
        high_performers = self.features_df[self.features_df['performance_segment'] == 'High']
        
        # Analyze common patterns in high performers
        common_patterns = []
        boolean_features = [col for col in self.features_df.columns if col.startswith('has_')]
        
        for feature in boolean_features:
            high_perf_rate = high_performers[feature].mean()
            overall_rate = self.features_df[feature].mean()
            
            if high_perf_rate > overall_rate * 1.5 and high_perf_rate > 0.2:  # At least 1.5x more common and present in 20%+ of high performers
                pattern = {
                    'type': 'high_performer_pattern',
                    'feature': feature,
                    'high_perf_rate': high_perf_rate,
                    'overall_rate': overall_rate,
                    'lift': high_perf_rate / overall_rate,
                    'description': f"High performers use '{feature}' {high_perf_rate:.1%} of the time vs {overall_rate:.1%} overall (lift: {high_perf_rate/overall_rate:.2f}x)"
                }
                common_patterns.append(pattern)
        
        # Sort by lift and add to recipes
        common_patterns.sort(key=lambda x: x['lift'], reverse=True)
        recipes.extend(common_patterns[:5])  # Top 5 patterns
        
        self.recipes = recipes
        
        print(f"   Generated {len(recipes)} performance recipes:")
        for i, recipe in enumerate(recipes[:10], 1):
            print(f"   {i}. {recipe['description']}")
        
        return recipes
    
    def save_results(self):
        """Save analysis results to files"""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Save performance recipes
        recipes_file = f'performance_recipes_{timestamp}.json'
        with open(recipes_file, 'w') as f:
            json.dump(self.recipes, f, indent=2, default=str)
        print(f"\n💾 Saved performance recipes to: {recipes_file}")
        
        # Save feature importance
        if self.feature_importance is not None:
            importance_file = f'feature_importance_{timestamp}.csv'
            self.feature_importance.to_csv(importance_file, index=False)
            print(f"💾 Saved feature importance to: {importance_file}")
        
        # Save association rules
        if len(self.performance_rules) > 0:
            rules_file = f'association_rules_{timestamp}.csv'
            self.performance_rules.to_csv(rules_file, index=False)
            print(f"💾 Saved association rules to: {rules_file}")
        
        # Save processed features
        features_file = f'performance_features_{timestamp}.csv'
        self.features_df.to_csv(features_file, index=False)
        print(f"💾 Saved processed features to: {features_file}")
        
        return recipes_file, importance_file, rules_file, features_file
    
    def run_full_analysis(self):
        """Run complete performance pattern analysis"""
        print("🚀 Starting Performance Pattern Discovery Engine")
        print("=" * 80)
        
        # Load data
        self.load_data()
        
        # Extract features
        self.extract_title_features()
        
        # Create performance segments
        self.create_performance_segments()
        
        # Discover association rules
        self.discover_association_rules()
        
        # Build predictive model
        self.build_predictive_model()
        
        # Generate performance recipes
        self.generate_performance_recipes()
        
        # Save results
        self.save_results()
        
        print("\n🎉 Performance Pattern Analysis Complete!")
        print("Next steps:")
        print("1. Review performance recipes for actionable insights")
        print("2. Validate patterns against known successful content")
        print("3. Build performance recipe API for real-time recommendations")
        print("4. Integrate with content strategy pipeline")

# Usage example
if __name__ == "__main__":
    # Use the existing exported embeddings
    title_embeddings_path = "exports/title-embeddings-for-clustering-2025-07-08T18-18-10-540Z.csv"
    
    print("🚀 Performance Pattern Discovery Engine")
    print("=" * 60)
    
    # Check if file exists
    import os
    if not os.path.exists(title_embeddings_path):
        print("❌ Title embeddings file not found!")
        print("   Please ensure the embedding export file exists:")
        print(f"   {title_embeddings_path}")
        exit(1)
    
    print(f"📁 Using file: {title_embeddings_path}")
    
    # Run analysis
    analyzer = PerformancePatternAnalyzer(title_embeddings_path)
    analyzer.run_full_analysis()
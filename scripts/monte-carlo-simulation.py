#!/usr/bin/env python3
"""
Monte Carlo simulation for Thumbnail Battle score distribution
Based on real game data analysis from the database
"""

import numpy as np
import matplotlib.pyplot as plt
from collections import Counter
import time

def simulate_thumbnail_battle_game():
    """
    Simulate a single game based on observed player patterns
    Returns: (final_score, battles_played, battles_won)
    """
    # Player skill distribution based on real data analysis
    # Weighted probabilities from actual game results
    accuracy_rate = np.random.choice(
        [0.33, 0.50, 0.60, 0.67, 0.71, 0.75, 0.78, 0.80, 0.83, 0.85, 0.91], 
        p=[0.05, 0.10, 0.15, 0.20, 0.15, 0.15, 0.08, 0.05, 0.04, 0.02, 0.01]
    )
    
    score = 0
    lives = 3
    battles = 0
    battles_won = 0
    
    while lives > 0:
        battles += 1
        
        # Simulate player decision (correct/incorrect)
        correct = np.random.random() < accuracy_rate
        
        if correct:
            battles_won += 1
            
            # Simulate response time (affects points)
            # Faster players tend to be more accurate, so bias toward faster times
            if accuracy_rate >= 0.80:
                # Skilled players: faster response times
                response_time = np.random.gamma(2, 1.5)  # Skewed toward fast times
            elif accuracy_rate >= 0.70:
                # Average players: moderate times  
                response_time = np.random.gamma(3, 2)
            else:
                # Slower players: more varied times
                response_time = np.random.gamma(4, 2.5)
            
            # Clamp to game limits (0.5 - 10 seconds)
            response_time = max(0.5, min(10.0, response_time))
            
            # Calculate points based on speed (game logic)
            if response_time <= 0.5:
                points = 1000
            elif response_time >= 10.0:
                points = 500
            else:
                # Linear decay from 1000 to 500 over 9.5 seconds
                points_lost = ((response_time - 0.5) / 9.5) * 500
                points = int(1000 - points_lost)
            
            score += points
        else:
            lives -= 1
    
    return score, battles, battles_won

def analyze_distribution(scores, battles_data, accuracy_data):
    """Analyze and display simulation results"""
    scores = np.array(scores)
    battles_data = np.array(battles_data)
    accuracy_data = np.array(accuracy_data)
    
    print("=== THUMBNAIL BATTLE MONTE CARLO SIMULATION ===")
    print(f"Simulations run: {len(scores):,}")
    print()
    
    print("SCORE DISTRIBUTION:")
    print(f"  Mean score: {np.mean(scores):,.0f}")
    print(f"  Median score: {np.median(scores):,.0f}")
    print(f"  Standard deviation: {np.std(scores):,.0f}")
    print()
    
    print("PERCENTILES:")
    percentiles = [10, 25, 50, 75, 90, 95, 99, 99.9]
    for p in percentiles:
        print(f"  {p:4.1f}th: {np.percentile(scores, p):6,.0f}")
    print()
    
    print("SCORE BUCKETS:")
    buckets = [
        (0, 0, "Zero"),
        (1, 999, "1-999"),
        (1000, 4999, "1K-5K"),
        (5000, 9999, "5K-10K"), 
        (10000, 19999, "10K-20K"),
        (20000, float('inf'), "20K+")
    ]
    
    for min_score, max_score, label in buckets:
        count = np.sum((scores >= min_score) & (scores <= max_score))
        pct = count / len(scores) * 100
        print(f"  {label:8}: {count:6,} ({pct:5.1f}%)")
    print()
    
    print("GAME LENGTH:")
    print(f"  Mean battles: {np.mean(battles_data):.1f}")
    print(f"  Median battles: {np.median(battles_data):.0f}")
    print(f"  Max battles: {np.max(battles_data):.0f}")
    print()
    
    print("ACCURACY PATTERNS:")
    print(f"  Mean accuracy: {np.mean(accuracy_data)*100:.1f}%")
    print(f"  Median accuracy: {np.median(accuracy_data)*100:.1f}%")
    print()
    
    # Top scores analysis
    top_1_pct = np.percentile(scores, 99)
    high_scores = scores[scores >= top_1_pct]
    high_accuracy = accuracy_data[scores >= top_1_pct]
    high_battles = battles_data[scores >= top_1_pct]
    
    print("TOP 1% ANALYSIS:")
    print(f"  Score threshold: {top_1_pct:,.0f}+")
    print(f"  Mean accuracy: {np.mean(high_accuracy)*100:.1f}%")
    print(f"  Mean game length: {np.mean(high_battles):.1f} battles")
    print(f"  Max score achieved: {np.max(scores):,.0f}")

def create_visualizations(scores, battles_data):
    """Create distribution plots"""
    fig, ((ax1, ax2), (ax3, ax4)) = plt.subplots(2, 2, figsize=(15, 10))
    
    # Score distribution histogram
    ax1.hist(scores, bins=100, alpha=0.7, edgecolor='black')
    ax1.set_xlabel('Final Score')
    ax1.set_ylabel('Frequency')
    ax1.set_title('Score Distribution (100K Simulations)')
    ax1.grid(True, alpha=0.3)
    
    # Log scale for better tail visibility
    ax2.hist(scores, bins=100, alpha=0.7, edgecolor='black')
    ax2.set_xlabel('Final Score')
    ax2.set_ylabel('Frequency (Log Scale)')
    ax2.set_title('Score Distribution (Log Scale)')
    ax2.set_yscale('log')
    ax2.grid(True, alpha=0.3)
    
    # Battles distribution
    ax3.hist(battles_data, bins=range(1, max(battles_data)+2), alpha=0.7, edgecolor='black')
    ax3.set_xlabel('Battles Played')
    ax3.set_ylabel('Frequency')
    ax3.set_title('Game Length Distribution')
    ax3.grid(True, alpha=0.3)
    
    # Score vs Battles scatter (sample)
    sample_size = min(5000, len(scores))
    indices = np.random.choice(len(scores), sample_size, replace=False)
    ax4.scatter([battles_data[i] for i in indices], [scores[i] for i in indices], alpha=0.5, s=1)
    ax4.set_xlabel('Battles Played')
    ax4.set_ylabel('Final Score')
    ax4.set_title('Score vs Game Length')
    ax4.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig('thumbnail_battle_simulation.png', dpi=150, bbox_inches='tight')
    print("Visualization saved as 'thumbnail_battle_simulation.png'")

def main():
    print("Starting Monte Carlo simulation...")
    print("Simulating 100,000 Thumbnail Battle games...")
    
    start_time = time.time()
    
    # Run simulations
    results = []
    for i in range(100_000):
        if i % 10_000 == 0 and i > 0:
            print(f"  Progress: {i:,} simulations completed")
        results.append(simulate_thumbnail_battle_game())
    
    end_time = time.time()
    print(f"Simulation completed in {end_time - start_time:.1f} seconds")
    print()
    
    # Extract data
    scores = [r[0] for r in results]
    battles_data = [r[1] for r in results]
    battles_won = [r[2] for r in results]
    accuracy_data = [w/b if b > 0 else 0 for w, b in zip(battles_won, battles_data)]
    
    # Analyze results
    analyze_distribution(scores, battles_data, accuracy_data)
    
    # Create visualizations
    try:
        create_visualizations(scores, battles_data)
    except ImportError:
        print("Matplotlib not available - skipping visualizations")
        print("Install with: pip install matplotlib")

if __name__ == "__main__":
    main()
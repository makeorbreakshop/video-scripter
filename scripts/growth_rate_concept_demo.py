#!/usr/bin/env python3

"""
Growth Rate Concept Demo
Shows how growth rate prediction creates smooth curves vs absolute view prediction
"""

import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime

def growth_rate_concept_demo():
    print("🚀 GROWTH RATE CONCEPT DEMONSTRATION")
    print("=" * 50)
    print("🎯 Showing why growth rates create smoother curves than absolute predictions")
    
    # Simulate a realistic video progression
    days = np.arange(1, 91)
    
    # Create "actual" video progression (what we're trying to backfill)
    true_views = []
    base_views = 50000
    
    for day in days:
        if day <= 7:
            # Initial viral growth
            growth_rate = 0.15 - (day * 0.02)  # 15% declining to 1%
        elif day <= 30:
            # Steady growth phase
            growth_rate = 0.02 - (day - 7) * 0.001  # 2% declining to 0.1%  
        else:
            # Plateau phase
            growth_rate = 0.005 - (day - 30) * 0.00005  # 0.5% declining to near 0%
        
        base_views *= (1 + max(growth_rate, 0.001))
        true_views.append(base_views)
    
    true_views = np.array(true_views)
    
    # Simulate sparse actual data (what we actually have)
    sparse_days = np.array([1, 5, 12, 25, 45, 70])
    sparse_views = true_views[sparse_days - 1]  # -1 for 0-based indexing
    
    print(f"📊 Simulated video progression:")
    print(f"   Sparse actual data: {len(sparse_days)} points")
    print(f"   View range: {sparse_views[0]:,.0f} to {sparse_views[-1]:,.0f}")
    
    # Method 1: Absolute View Prediction (current broken approach)
    print(f"\n🔴 Method 1: Absolute View Prediction (broken)")
    absolute_predictions = []
    
    for day in days:
        if day in sparse_days:
            # Use actual data
            idx = np.where(sparse_days == day)[0][0]
            pred_views = sparse_views[idx]
        else:
            # Simulate noisy absolute predictions (what ML was doing wrong)
            # Find nearest actual point
            distances = np.abs(sparse_days - day)
            nearest_idx = np.argmin(distances)
            nearest_views = sparse_views[nearest_idx]
            
            # Add random noise to simulate ML prediction errors
            noise_factor = 1 + np.random.normal(0, 0.3)  # 30% noise
            pred_views = nearest_views * noise_factor
            
            # This creates unrealistic jumps!
        
        absolute_predictions.append(pred_views)
    
    absolute_predictions = np.array(absolute_predictions)
    
    # Method 2: Growth Rate Prediction (proposed solution)
    print(f"🟢 Method 2: Growth Rate Prediction (smooth)")
    growth_rate_predictions = []
    
    current_views = sparse_views[0]  # Start from first actual point
    
    for day in days:
        if day in sparse_days:
            # Use actual data and reset
            idx = np.where(sparse_days == day)[0][0]
            current_views = sparse_views[idx]
        else:
            # Predict growth rate (much more stable than absolute views)
            if day <= 7:
                predicted_growth = 0.08 + np.random.normal(0, 0.01)  # ~8% ± 1%
            elif day <= 30:
                predicted_growth = 0.015 + np.random.normal(0, 0.005)  # ~1.5% ± 0.5%
            else:
                predicted_growth = 0.003 + np.random.normal(0, 0.001)  # ~0.3% ± 0.1%
            
            # Apply growth rate (naturally smooth)
            current_views *= (1 + max(predicted_growth, 0.001))
        
        growth_rate_predictions.append(current_views)
    
    growth_rate_predictions = np.array(growth_rate_predictions)
    
    # Create visualization
    print(f"🎨 Creating comparison visualization...")
    
    fig, axes = plt.subplots(2, 2, figsize=(15, 10))
    
    # Top left: True progression with sparse data
    ax1 = axes[0, 0]
    ax1.plot(days, true_views, 'g-', linewidth=3, alpha=0.7, label='True Video Progression')
    ax1.scatter(sparse_days, sparse_views, color='red', s=100, zorder=5, label='Sparse Actual Data (what we have)')
    ax1.set_title('Ground Truth: Actual Video Performance')
    ax1.set_xlabel('Days Since Published')
    ax1.set_ylabel('View Count')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    ax1.set_yscale('log')
    
    # Top right: Absolute prediction method (broken)
    ax2 = axes[0, 1]
    ax2.plot(days, absolute_predictions, 'r-', linewidth=2, alpha=0.8, label='Absolute View Predictions')
    ax2.scatter(sparse_days, sparse_views, color='red', s=100, zorder=5, label='Actual Data Points')
    ax2.plot(days, true_views, 'g--', alpha=0.4, label='True Progression')
    ax2.set_title('❌ Method 1: Absolute View Prediction (Noisy/Jumpy)')
    ax2.set_xlabel('Days Since Published')
    ax2.set_ylabel('View Count')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    ax2.set_yscale('log')
    
    # Bottom left: Growth rate prediction method (smooth)
    ax3 = axes[1, 0]
    ax3.plot(days, growth_rate_predictions, 'b-', linewidth=2, alpha=0.8, label='Growth Rate Predictions')
    ax3.scatter(sparse_days, sparse_views, color='red', s=100, zorder=5, label='Actual Data Points')
    ax3.plot(days, true_views, 'g--', alpha=0.4, label='True Progression')
    ax3.set_title('✅ Method 2: Growth Rate Prediction (Smooth)')
    ax3.set_xlabel('Days Since Published')
    ax3.set_ylabel('View Count')
    ax3.legend()
    ax3.grid(True, alpha=0.3)
    ax3.set_yscale('log')
    
    # Bottom right: Comparison of methods
    ax4 = axes[1, 1]
    ax4.plot(days, true_views, 'g-', linewidth=3, alpha=0.8, label='True Progression')
    ax4.plot(days, absolute_predictions, 'r-', linewidth=1, alpha=0.7, label='Absolute Method (Jumpy)')
    ax4.plot(days, growth_rate_predictions, 'b-', linewidth=2, alpha=0.8, label='Growth Rate Method (Smooth)')
    ax4.scatter(sparse_days, sparse_views, color='black', s=80, zorder=5, label='Actual Data')
    ax4.set_title('🔍 Method Comparison')
    ax4.set_xlabel('Days Since Published')
    ax4.set_ylabel('View Count')
    ax4.legend()
    ax4.grid(True, alpha=0.3)
    ax4.set_yscale('log')
    
    plt.suptitle('Growth Rate vs Absolute View Prediction: Why Growth Rates Work Better', 
                fontsize=14, fontweight='bold')
    plt.tight_layout()
    
    # Calculate metrics
    abs_error = np.mean(np.abs(absolute_predictions - true_views) / true_views)
    growth_error = np.mean(np.abs(growth_rate_predictions - true_views) / true_views)
    
    print(f"\n📊 COMPARISON METRICS:")
    print(f"   Absolute Method Error: {abs_error:.1%}")
    print(f"   Growth Rate Method Error: {growth_error:.1%}")
    print(f"   Growth Rate Method is {(abs_error/growth_error - 1)*100:.1f}% better")
    
    # Calculate curve smoothness (variance of day-to-day changes)
    abs_daily_changes = np.abs(np.diff(absolute_predictions) / absolute_predictions[:-1])
    growth_daily_changes = np.abs(np.diff(growth_rate_predictions) / growth_rate_predictions[:-1])
    
    abs_smoothness = np.std(abs_daily_changes)
    growth_smoothness = np.std(growth_daily_changes)
    
    print(f"\n📈 CURVE SMOOTHNESS:")
    print(f"   Absolute Method Volatility: {abs_smoothness:.3f}")
    print(f"   Growth Rate Method Volatility: {growth_smoothness:.3f}")
    print(f"   Growth Rate Method is {(abs_smoothness/growth_smoothness):.1f}x smoother")
    
    # Save
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    viz_path = f'data/growth_rate_concept_{timestamp}.png'
    plt.savefig(viz_path, dpi=300, bbox_inches='tight')
    plt.close()
    
    print(f"\n🎉 CONCEPT DEMONSTRATION COMPLETE!")
    print(f"✅ Growth rate prediction creates inherently smoother curves")
    print(f"✅ {(abs_error/growth_error - 1)*100:.1f}% more accurate than absolute prediction")
    print(f"✅ {(abs_smoothness/growth_smoothness):.1f}x smoother progression curves")
    print(f"💾 Visualization: {viz_path}")
    
    return viz_path

if __name__ == "__main__":
    growth_rate_concept_demo()
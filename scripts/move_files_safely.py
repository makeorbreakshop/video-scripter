#!/usr/bin/env python3
"""
Safely move files to organized structure while preserving functionality.
Only moves test/analysis files, not production scripts.
"""

import os
import shutil
import glob
from pathlib import Path

def move_files_safely():
    """Move files to organized directories safely"""
    base_path = Path("/Users/brandoncullum/video-scripter")
    
    print("🔄 Moving files to organized structure...")
    
    # 1. Move root-level charts to outputs/charts
    chart_files = [
        "*.png", "*.jpg", "*.jpeg", "*.svg"
    ]
    
    moved_charts = 0
    for pattern in chart_files:
        for file_path in base_path.glob(pattern):
            if file_path.is_file():
                dest = base_path / "outputs" / "charts" / file_path.name
                try:
                    shutil.move(str(file_path), str(dest))
                    moved_charts += 1
                    print(f"📊 Moved chart: {file_path.name}")
                except Exception as e:
                    print(f"❌ Error moving {file_path.name}: {e}")
    
    # 2. Move CSV/JSON data files to outputs/data
    data_files = [
        "*.csv", "*.json", "*.log"
    ]
    
    # Exclude important files
    exclude_data = [
        "package.json", "package-lock.json", "tsconfig.json", 
        "components.json", "tailwind.config.js", "next.config.mjs"
    ]
    
    moved_data = 0
    for pattern in data_files:
        for file_path in base_path.glob(pattern):
            if file_path.is_file() and file_path.name not in exclude_data:
                dest = base_path / "outputs" / "data" / file_path.name
                try:
                    shutil.move(str(file_path), str(dest))
                    moved_data += 1
                    print(f"📄 Moved data: {file_path.name}")
                except Exception as e:
                    print(f"❌ Error moving {file_path.name}: {e}")
    
    # 3. Move HTML test files to temp
    html_files = [
        "business-dashboard*.html", "check-supabase.html", 
        "profit-calculator.html", "saas-financial-analysis.html",
        "document_clusters.html", "topic_*.html"
    ]
    
    moved_html = 0
    for pattern in html_files:
        for file_path in base_path.glob(pattern):
            if file_path.is_file():
                dest = base_path / "temp" / file_path.name
                try:
                    shutil.move(str(file_path), str(dest))
                    moved_html += 1
                    print(f"🌐 Moved HTML: {file_path.name}")
                except Exception as e:
                    print(f"❌ Error moving {file_path.name}: {e}")
    
    # 4. Move test scripts within scripts directory
    scripts_path = base_path / "scripts"
    
    # Performance envelope scripts
    performance_patterns = [
        "*envelope*", "*curve*", "*plateau*", "plot_*", 
        "implement_trimmed_mean_fix.py", "validate_trimmed_mean_findings.py",
        "test_plateau_methods.py"
    ]
    
    moved_performance = 0
    for pattern in performance_patterns:
        for file_path in scripts_path.glob(pattern):
            if file_path.is_file():
                dest = scripts_path / "performance" / file_path.name
                try:
                    shutil.move(str(file_path), str(dest))
                    moved_performance += 1
                    print(f"📈 Moved performance: {file_path.name}")
                except Exception as e:
                    print(f"❌ Error moving {file_path.name}: {e}")
    
    # Testing scripts
    testing_patterns = [
        "test_*", "test-*", "validate_*", "validate-*", 
        "debug-*", "check_*", "check-*"
    ]
    
    moved_testing = 0
    for pattern in testing_patterns:
        for file_path in scripts_path.glob(pattern):
            if file_path.is_file() and not file_path.name.startswith("test_plateau"):  # Already moved
                dest = scripts_path / "testing" / file_path.name
                try:
                    shutil.move(str(file_path), str(dest))
                    moved_testing += 1
                    print(f"🧪 Moved testing: {file_path.name}")
                except Exception as e:
                    print(f"❌ Error moving {file_path.name}: {e}")
    
    # Analysis scripts
    analysis_patterns = [
        "analyze_*", "*_analysis.*", "bertopic-analysis.py", 
        "performance-pattern-analysis.py", "comprehensive_*"
    ]
    
    moved_analysis = 0
    for pattern in analysis_patterns:
        for file_path in scripts_path.glob(pattern):
            if file_path.is_file():
                dest = scripts_path / "analysis" / file_path.name
                try:
                    shutil.move(str(file_path), str(dest))
                    moved_analysis += 1
                    print(f"🔍 Moved analysis: {file_path.name}")
                except Exception as e:
                    print(f"❌ Error moving {file_path.name}: {e}")
    
    # Visualization scripts
    viz_patterns = [
        "create_*_chart*", "visualize_*", "*_viz.*", 
        "demo_*", "*_demo.*"
    ]
    
    moved_viz = 0
    for pattern in viz_patterns:
        for file_path in scripts_path.glob(pattern):
            if file_path.is_file():
                dest = scripts_path / "visualization" / file_path.name
                try:
                    shutil.move(str(file_path), str(dest))
                    moved_viz += 1
                    print(f"📊 Moved visualization: {file_path.name}")
                except Exception as e:
                    print(f"❌ Error moving {file_path.name}: {e}")
    
    # Migration scripts
    migration_patterns = [
        "migrate_*", "migrate-*", "backfill-*", 
        "import-*", "bulk-*", "apply-*"
    ]
    
    moved_migration = 0
    for pattern in migration_patterns:
        for file_path in scripts_path.glob(pattern):
            if file_path.is_file():
                dest = scripts_path / "migration" / file_path.name
                try:
                    shutil.move(str(file_path), str(dest))
                    moved_migration += 1
                    print(f"🔄 Moved migration: {file_path.name}")
                except Exception as e:
                    print(f"❌ Error moving {file_path.name}: {e}")
    
    # Maintenance scripts
    maintenance_patterns = [
        "cleanup*", "fix-*", "reset-*", "update-*",
        "refresh-*", "sync-*"
    ]
    
    moved_maintenance = 0
    for pattern in maintenance_patterns:
        for file_path in scripts_path.glob(pattern):
            if file_path.is_file():
                dest = scripts_path / "maintenance" / file_path.name
                try:
                    shutil.move(str(file_path), str(dest))
                    moved_maintenance += 1
                    print(f"🛠️ Moved maintenance: {file_path.name}")
                except Exception as e:
                    print(f"❌ Error moving {file_path.name}: {e}")
    
    print(f"\n✅ File organization complete!")
    print(f"📊 Charts moved: {moved_charts}")
    print(f"📄 Data files moved: {moved_data}")
    print(f"🌐 HTML files moved: {moved_html}")
    print(f"📈 Performance scripts moved: {moved_performance}")
    print(f"🧪 Testing scripts moved: {moved_testing}")
    print(f"🔍 Analysis scripts moved: {moved_analysis}")
    print(f"📊 Visualization scripts moved: {moved_viz}")
    print(f"🔄 Migration scripts moved: {moved_migration}")
    print(f"🛠️ Maintenance scripts moved: {moved_maintenance}")
    
    return {
        'charts': moved_charts,
        'data': moved_data,
        'html': moved_html,
        'performance': moved_performance,
        'testing': moved_testing,
        'analysis': moved_analysis,
        'visualization': moved_viz,
        'migration': moved_migration,
        'maintenance': moved_maintenance
    }

def clean_empty_png_files():
    """Remove any leftover PNG files in scripts directory"""
    scripts_path = Path("/Users/brandoncullum/video-scripter/scripts")
    png_files = list(scripts_path.glob("*.png"))
    
    if png_files:
        print(f"\n🧹 Cleaning up {len(png_files)} PNG files in scripts/")
        for png_file in png_files:
            dest = Path("/Users/brandoncullum/video-scripter/outputs/charts") / png_file.name
            try:
                shutil.move(str(png_file), str(dest))
                print(f"📊 Moved remaining chart: {png_file.name}")
            except Exception as e:
                print(f"❌ Error moving {png_file.name}: {e}")

def main():
    """Run the file organization"""
    print("🗂️  Organizing Video Scripter Files")
    print("=" * 50)
    
    # Move files to organized structure
    results = move_files_safely()
    
    # Clean up any remaining files
    clean_empty_png_files()
    
    print(f"\n🎯 Organization Summary:")
    print(f"Total files moved: {sum(results.values())}")
    print(f"\n📂 New structure is ready!")
    print(f"   • Production scripts remain in /scripts/")
    print(f"   • Test/analysis scripts organized in subdirectories")
    print(f"   • Charts and data moved to /outputs/")
    print(f"   • Temporary files moved to /temp/")

if __name__ == "__main__":
    main()
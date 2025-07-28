#!/usr/bin/env python3
"""
Organize project structure by moving test scripts, analysis files, and outputs 
to appropriate directories without breaking functionality.
"""

import os
import shutil
import json
import sys
from pathlib import Path
from datetime import datetime

def create_directory_structure():
    """Create organized directory structure"""
    base_path = Path("/Users/brandoncullum/video-scripter")
    
    # Create new organized directories
    directories = {
        "scripts/analysis": "Data analysis and research scripts",
        "scripts/testing": "Test scripts and validation",
        "scripts/maintenance": "Database maintenance and cleanup scripts", 
        "scripts/performance": "Performance envelope related scripts",
        "scripts/migration": "Data migration scripts",
        "scripts/visualization": "Chart and graph generation scripts",
        "outputs/charts": "Generated charts and visualizations",
        "outputs/data": "Exported data files and CSVs",
        "outputs/reports": "Analysis reports and summaries",
        "temp": "Temporary files and test outputs"
    }
    
    for dir_path, description in directories.items():
        full_path = base_path / dir_path
        full_path.mkdir(parents=True, exist_ok=True)
        print(f"✅ Created: {dir_path} - {description}")

def organize_root_files():
    """Move scattered files from root to appropriate directories"""
    base_path = Path("/Users/brandoncullum/video-scripter")
    
    # Files to move from root
    file_moves = {
        # Charts and visualizations
        "outputs/charts": [
            "*.png", "*.jpg", "*.jpeg", "*.svg",
            "comprehensive_performance_envelope.png",
            "final_performance_envelope_demo.png",
            "individual_channel_analysis.png",
            "plateau_method_comparison.png",
            "trimmed_mean_implementation_comparison.png"
        ],
        
        # Data exports and CSVs
        "outputs/data": [
            "*.csv", "*.json",
            "association_rules_*.csv",
            "bertopic_results_*.csv", 
            "plateau_method_test_results.csv"
        ],
        
        # Reports and documentation
        "outputs/reports": [
            "*.md",
            "cost-optimization-analysis.md",
            "domain-detection-test-results.md",
            "import-fixes-summary.md",
            "pattern-analysis-results.md",
            "test-analysis-report.md",
            "youtube-performance-envelope-report.md"
        ],
        
        # Temporary/test files
        "temp": [
            "*.log", "*.html",
            "test-*.js", "test-*.py", "test-*.cjs",
            "business-dashboard*.html",
            "check-supabase.html",
            "profit-calculator.html"
        ]
    }
    
    return file_moves

def organize_scripts():
    """Organize scripts directory by purpose"""
    scripts_path = Path("/Users/brandoncullum/video-scripter/scripts")
    
    script_categories = {
        "analysis": [
            "analyze_*", "*_analysis.*", "comprehensive_*",
            "bertopic-analysis.py", "performance-pattern-analysis.py"
        ],
        
        "testing": [
            "test_*", "test-*", "validate_*", "validate-*",
            "debug-*", "check_*", "check-*"
        ],
        
        "performance": [
            "*envelope*", "*curve*", "*plateau*", 
            "implement_trimmed_mean_fix.py", "plot_*"
        ],
        
        "visualization": [
            "create_*_chart*", "visualize_*", "*_viz.*",
            "demo_*", "*_demo.*"
        ],
        
        "migration": [
            "migrate_*", "migrate-*", "backfill-*", 
            "import-*", "bulk-*", "apply-*"
        ],
        
        "maintenance": [
            "cleanup*", "fix-*", "reset-*", "update-*",
            "refresh-*", "sync-*"
        ]
    }
    
    return script_categories

def safe_move_file(src, dst):
    """Safely move file, creating directories as needed"""
    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.exists() and not dst.exists():
            shutil.move(str(src), str(dst))
            return True
    except Exception as e:
        print(f"❌ Error moving {src} to {dst}: {e}")
    return False

def create_readme_files():
    """Create README files for each organized directory"""
    base_path = Path("/Users/brandoncullum/video-scripter")
    
    readmes = {
        "scripts/analysis/README.md": """# Analysis Scripts

Scripts for data analysis, research, and exploration.

## Key Scripts:
- `bertopic-analysis.py` - Topic modeling analysis
- `performance-pattern-analysis.py` - Performance pattern discovery
- `analyze_*` scripts - Various data analysis tasks
""",
        
        "scripts/testing/README.md": """# Testing Scripts

Validation, testing, and debugging scripts.

## Key Scripts:
- `test_plateau_methods.py` - Plateau calculation testing
- `validate_*` scripts - System validation
- `check_*` scripts - Health checks and debugging
""",
        
        "scripts/performance/README.md": """# Performance Envelope Scripts

Scripts related to YouTube performance envelope system.

## Key Scripts:
- `implement_trimmed_mean_fix.py` - Plateau calculation fix
- `*envelope*` scripts - Performance envelope generation
- `plot_*` scripts - Performance visualization
""",
        
        "scripts/visualization/README.md": """# Visualization Scripts

Chart and graph generation scripts.

## Key Scripts:
- `create_*_chart*` - Chart generation
- `visualize_*` - Data visualization
- `demo_*` - Demo visualizations
""",
        
        "outputs/charts/README.md": """# Generated Charts

All visualization outputs and charts.

## Types:
- Performance envelope charts
- Analysis visualizations  
- Test result graphs
- Demo charts
""",
        
        "outputs/data/README.md": """# Exported Data

CSV files, JSON exports, and data outputs.

## Types:
- Analysis results
- Test data
- Export files
- Processed datasets
""",
        
        "temp/README.md": """# Temporary Files

Temporary files, logs, and test outputs.

**Note**: Files in this directory can be safely deleted.
"""
    }
    
    for readme_path, content in readmes.items():
        full_path = base_path / readme_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        with open(full_path, 'w') as f:
            f.write(content)
        print(f"📝 Created: {readme_path}")

class SafeFileOrganizer:
    """Safely organize files with dry-run capability and logging"""
    
    def __init__(self, base_path, dry_run=True):
        self.base_path = Path(base_path)
        self.dry_run = dry_run
        self.migration_log = []
        self.errors = []
        
    def log_action(self, action, source, destination=None):
        """Log each action taken"""
        entry = {
            'action': action,
            'source': str(source),
            'destination': str(destination) if destination else None,
            'timestamp': datetime.now().isoformat()
        }
        self.migration_log.append(entry)
        
    def move_file_safely(self, src, dst):
        """Safely move a file with logging"""
        try:
            if self.dry_run:
                print(f"  [DRY RUN] Would move: {src.name} -> {dst}")
                self.log_action('move_file', src, dst)
                return True
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                if src.exists() and not dst.exists():
                    shutil.move(str(src), str(dst))
                    print(f"  ✅ Moved: {src.name} -> {dst}")
                    self.log_action('move_file', src, dst)
                    return True
                elif dst.exists():
                    print(f"  ⚠️  Skipped (already exists): {dst}")
                    return False
        except Exception as e:
            error_msg = f"Error moving {src} to {dst}: {e}"
            print(f"  ❌ {error_msg}")
            self.errors.append(error_msg)
            return False
            
    def organize_root_files(self):
        """Move files from root to organized directories"""
        print("\n📦 Organizing root directory files...")
        
        moves = organize_root_files()
        total_moved = 0
        
        for target_dir, patterns in moves.items():
            target_path = self.base_path / target_dir
            print(f"\n  Moving to {target_dir}:")
            
            for pattern in patterns:
                if '*' in pattern:
                    # Handle glob patterns
                    files = list(self.base_path.glob(pattern))
                else:
                    # Handle specific files
                    file_path = self.base_path / pattern
                    files = [file_path] if file_path.exists() else []
                    
                for src_file in files:
                    if src_file.is_file():
                        dst_file = target_path / src_file.name
                        if self.move_file_safely(src_file, dst_file):
                            total_moved += 1
                            
        return total_moved
        
    def organize_scripts_directory(self):
        """Organize scripts into categorized subdirectories"""
        print("\n📁 Organizing scripts directory...")
        
        categories = organize_scripts()
        scripts_path = self.base_path / "scripts"
        total_moved = 0
        
        for category, patterns in categories.items():
            target_path = scripts_path / category
            print(f"\n  Moving to scripts/{category}:")
            
            for pattern in patterns:
                files = list(scripts_path.glob(pattern))
                
                for src_file in files:
                    if src_file.is_file() and src_file.parent == scripts_path:
                        dst_file = target_path / src_file.name
                        if self.move_file_safely(src_file, dst_file):
                            total_moved += 1
                            
        return total_moved
        
    def clean_old_exports(self):
        """Archive old export files"""
        print("\n🗄️  Archiving old exports...")
        
        exports_dir = self.base_path / "exports"
        archive_dir = self.base_path / "archive" / "exports"
        total_archived = 0
        
        if exports_dir.exists():
            # Keep only the most recent 5 of each type
            patterns = ['thumbnail-embeddings-*.json', 'thumbnail-embeddings-*.csv']
            
            for pattern in patterns:
                files = sorted(exports_dir.glob(pattern), 
                             key=lambda x: x.stat().st_mtime, reverse=True)
                
                if len(files) > 5:
                    print(f"\n  Archiving old {pattern} files:")
                    for old_file in files[5:]:
                        dst_file = archive_dir / old_file.name
                        if self.move_file_safely(old_file, dst_file):
                            total_archived += 1
                            
        return total_archived
        
    def save_migration_log(self):
        """Save the migration log to a file"""
        log_dir = self.base_path / "migration_logs"
        log_dir.mkdir(exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_file = log_dir / f"migration_log_{timestamp}.json"
        
        with open(log_file, 'w') as f:
            json.dump({
                'timestamp': timestamp,
                'dry_run': self.dry_run,
                'actions': self.migration_log,
                'errors': self.errors
            }, f, indent=2)
            
        print(f"\n📝 Migration log saved to: {log_file}")
        return log_file

def main():
    """Run the organization process"""
    print("🗂️  Organizing Video Scripter Project Structure")
    print("=" * 60)
    
    # Check for command line arguments
    dry_run = '--execute' not in sys.argv
    
    if dry_run:
        print("\n🔍 DRY RUN MODE - No files will be moved")
        print("   To execute: python scripts/organize_project_structure.py --execute")
    else:
        print("\n⚠️  EXECUTE MODE - Files will be moved!")
        response = input("   Are you sure? (yes/no): ")
        if response.lower() != 'yes':
            print("   Aborted.")
            return
    
    # Initialize organizer
    organizer = SafeFileOrganizer("/Users/brandoncullum/video-scripter", dry_run)
    
    # Create directory structure
    print("\n1. Creating organized directory structure...")
    create_directory_structure()
    
    # Create README files
    print("\n2. Creating README files...")
    create_readme_files()
    
    # Organize files
    print("\n3. Organizing files...")
    root_moved = organizer.organize_root_files()
    scripts_moved = organizer.organize_scripts_directory()
    archived = organizer.clean_old_exports()
    
    # Save migration log
    log_file = organizer.save_migration_log()
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 SUMMARY:")
    print(f"   - Root files organized: {root_moved}")
    print(f"   - Scripts organized: {scripts_moved}")
    print(f"   - Old exports archived: {archived}")
    print(f"   - Total actions: {len(organizer.migration_log)}")
    print(f"   - Errors: {len(organizer.errors)}")
    
    if organizer.errors:
        print("\n❌ Errors encountered:")
        for error in organizer.errors[:5]:
            print(f"   - {error}")
        if len(organizer.errors) > 5:
            print(f"   ... and {len(organizer.errors) - 5} more")
    
    print(f"\n✅ Project structure organization complete!")
    print(f"\nNew structure:")
    print(f"├── scripts/")
    print(f"│   ├── analysis/      - Data analysis scripts")
    print(f"│   ├── testing/       - Test and validation scripts")
    print(f"│   ├── performance/   - Performance envelope scripts")
    print(f"│   ├── visualization/ - Chart generation scripts")
    print(f"│   ├── migration/     - Data migration scripts")
    print(f"│   ├── maintenance/   - Cleanup and maintenance")
    print(f"│   └── clustering/    - Clustering analysis (preserved)")
    print(f"├── outputs/")
    print(f"│   ├── charts/        - Generated visualizations")
    print(f"│   ├── data/          - Exported data files")
    print(f"│   └── reports/       - Analysis reports")
    print(f"├── archive/")
    print(f"│   └── exports/       - Old export files")
    print(f"├── temp/              - Temporary files")
    print(f"└── migration_logs/    - Migration history")
    
    if dry_run:
        print(f"\n💡 To execute the migration:")
        print(f"   python scripts/organize_project_structure.py --execute")

if __name__ == "__main__":
    main()
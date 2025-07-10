#!/usr/bin/env node

/**
 * Claude Code Analysis: Generate Names for Improved BERTopic Results
 * Analyzes the improved clustering results with clean content themes
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ImprovedTopicNamingAnalyzer {
  constructor() {
    this.results = null;
    this.topicNames = {
      'Level 1 - Broad Domains': {},
      'Level 2 - Niches': {},
      'Level 3 - Micro Topics': {}
    };
  }

  loadResults() {
    console.log('📂 Loading improved BERTopic results for analysis...');
    
    // Find the latest improved results file
    const resultsFile = '/Users/brandoncullum/video-scripter/exports/improved-bertopic-results-2025-07-10_13-40-28.json';
    this.results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    
    console.log(`✅ Loaded improved results for ${Object.keys(this.results).length} levels`);
  }

  generateCleanTopicName(keywords, repDocs, videoCount, level, topicId) {
    // Clean content-focused naming strategy
    const primaryKeywords = keywords.slice(0, 4);
    const allKeywords = keywords.slice(0, 8);
    
    if (level === 1) {
      // Level 1: True broad domains (6 total)
      if (primaryKeywords.includes('woodworking') || primaryKeywords.includes('wood')) {
        return 'Woodworking & Carpentry';
      }
      if (primaryKeywords.includes('printing') || primaryKeywords.includes('printer')) {
        return '3D Printing & Design';
      }
      if (primaryKeywords.includes('food') || primaryKeywords.includes('recipe')) {
        return 'Food & Cooking';
      }
      if (primaryKeywords.includes('laser') || primaryKeywords.includes('engraving')) {
        return 'Laser Tools & Engraving';
      }
      if (primaryKeywords.includes('coffee') && primaryKeywords.includes('table')) {
        return 'Coffee Tables & Furniture';
      }
      if (primaryKeywords.includes('epoxy') || primaryKeywords.includes('resin')) {
        return 'Epoxy & Resin Projects';
      }
      
      // Fallback for any unexpected Level 1 topics
      return this.createDescriptiveName(primaryKeywords, 'Broad');
    }
    
    if (level === 2) {
      // Level 2: Specific niches (113 total)
      const combined = allKeywords.join(' ');
      
      // Furniture & Tables
      if (combined.includes('dining table')) return 'Dining Table Making';
      if (combined.includes('coffee table')) return 'Coffee Table Projects';
      if (combined.includes('chair') && combined.includes('pallet')) return 'Pallet Chair Building';
      if (combined.includes('cabinet')) return 'Cabinet & Storage';
      
      // 3D Printing specifics
      if (combined.includes('printing') && combined.includes('printer')) return '3D Printing Projects';
      if (combined.includes('print farm')) return '3D Print Farm Setup';
      
      // Laser work
      if (combined.includes('laser') && combined.includes('engraving')) return 'Laser Engraving';
      if (combined.includes('fiber') && combined.includes('laser')) return 'Fiber Laser Work';
      
      // Food specifics
      if (combined.includes('pizza')) return 'Pizza Making';
      if (combined.includes('chicken') && combined.includes('recipe')) return 'Chicken Recipes';
      
      // Home & Construction
      if (combined.includes('tile') && combined.includes('install')) return 'Tile Installation';
      if (combined.includes('shower') && combined.includes('vinyl')) return 'Bathroom Renovation';
      if (combined.includes('flooring')) return 'Flooring Installation';
      
      // Business & Lifestyle
      if (combined.includes('quit') && combined.includes('job')) return 'Career Change Content';
      if (combined.includes('profit') && combined.includes('woodworking')) return 'Profitable Woodworking';
      
      // General patterns
      if (primaryKeywords.includes('ideas') && primaryKeywords.includes('project')) {
        return 'Project Ideas & Inspiration';
      }
      
      return this.createDescriptiveName(primaryKeywords, 'Niche');
    }
    
    if (level === 3) {
      // Level 3: Micro-specializations (456 total)
      const combined = allKeywords.join(' ');
      
      // Very specific techniques
      if (combined.includes('laser engraver')) return 'Laser Engraver Techniques';
      if (combined.includes('ring making')) return 'Ring Making & Jewelry';
      if (combined.includes('guitar build')) return 'Guitar Building';
      if (combined.includes('drywall') && combined.includes('tape')) return 'Drywall Taping & Repair';
      if (combined.includes('carbon fiber')) return 'Carbon Fiber Projects';
      if (combined.includes('cosplay diycrafts')) return 'Cosplay Crafting';
      if (combined.includes('bunk bed')) return 'Bunk Bed Building';
      if (combined.includes('woodworking tools')) return 'Woodworking Tool Reviews';
      if (combined.includes('spray') && combined.includes('painting')) return 'Spray Painting Techniques';
      if (combined.includes('print farm')) return '3D Print Farm Management';
      
      // Food specifics
      if (primaryKeywords.includes('chicken') && primaryKeywords.includes('steak')) {
        return 'Meat Cooking Techniques';
      }
      
      return this.createDescriptiveName(primaryKeywords, 'Micro');
    }
    
    return this.createDescriptiveName(primaryKeywords, 'General');
  }

  createDescriptiveName(keywords, level) {
    // Filter out generic maker terms
    const contentKeywords = keywords
      .filter(k => !['diy', 'make', 'build', 'project', 'ideas'].includes(k.toLowerCase()))
      .filter(k => k.length > 2)
      .slice(0, 3);
    
    if (contentKeywords.length === 0) {
      return level === 'Broad' ? 'General Making' : 
             level === 'Niche' ? 'General Projects' : 'General Techniques';
    }
    
    // Capitalize and format
    const formatted = contentKeywords
      .map(k => k.charAt(0).toUpperCase() + k.slice(1))
      .join(' & ');
    
    // Add appropriate suffix
    const suffixes = {
      'Broad': '',
      'Niche': ' Projects', 
      'Micro': ' Techniques',
      'General': ''
    };
    
    return formatted + (suffixes[level] || '');
  }

  analyzeAllTopics() {
    console.log('\n🔍 Analyzing improved topics to generate meaningful names...\n');
    
    for (const [levelName, levelData] of Object.entries(this.results)) {
      const levelNumber = levelName.includes('Level 1') ? 1 : 
                         levelName.includes('Level 2') ? 2 : 3;
      
      console.log(`📋 Processing ${levelName} (${levelData.actual_clusters} topics)...`);
      
      const levelNames = {};
      
      for (const topicInfo of levelData.topic_info) {
        const topicId = topicInfo.Topic;
        
        // Skip outlier topic (-1)
        if (topicId === -1) {
          levelNames[topicId] = 'Uncategorized';
          continue;
        }
        
        const keywords = levelData.top_words_per_topic[topicId] || [];
        const videoCount = topicInfo.Count;
        const repDocs = topicInfo.Representative_Docs || [];
        
        const generatedName = this.generateCleanTopicName(keywords, repDocs, videoCount, levelNumber, topicId);
        levelNames[topicId] = generatedName;
        
        // Only show first 20 topics for each level to avoid overwhelming output
        if (Object.keys(levelNames).length <= 21) {
          console.log(`   Topic ${topicId}: "${generatedName}" (${videoCount} videos) - [${keywords.slice(0, 3).join(', ')}]`);
        }
      }
      
      if (levelData.actual_clusters > 20) {
        console.log(`   ... and ${levelData.actual_clusters - 20} more topics`);
      }
      
      this.topicNames[levelName] = levelNames;
      console.log(`✅ Generated names for ${Object.keys(levelNames).length} topics\n`);
    }
  }

  generateSQLUpdate() {
    console.log('📝 Generating SQL update statements for improved topics...');
    
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
    const sqlFile = `/Users/brandoncullum/video-scripter/exports/improved-topic-names-update-${timestamp}.sql`;
    
    let sql = `-- Improved Topic Names Update Generated by Claude Code Analysis\n`;
    sql += `-- Generated: ${new Date().toISOString()}\n`;
    sql += `-- Based on improved BERTopic analysis with clean content themes\n\n`;
    sql += `BEGIN;\n\n`;
    
    for (const [levelName, levelNames] of Object.entries(this.topicNames)) {
      const levelNumber = levelName.includes('Level 1') ? 1 : 
                         levelName.includes('Level 2') ? 2 : 3;
      
      sql += `-- ${levelName} (${Object.keys(levelNames).length} topics)\n`;
      
      for (const [topicId, name] of Object.entries(levelNames)) {
        const escapedName = name.replace(/'/g, "''");
        sql += `UPDATE topic_categories SET name = '${escapedName}' WHERE level = ${levelNumber} AND topic_id = ${topicId};\n`;
      }
      sql += `\n`;
    }
    
    sql += `COMMIT;\n\n`;
    sql += `-- Verification queries:\n`;
    sql += `-- SELECT level, topic_id, name, video_count FROM topic_categories WHERE name IS NOT NULL ORDER BY level, video_count DESC;\n`;
    sql += `-- SELECT level, COUNT(*) as named_topics FROM topic_categories WHERE name IS NOT NULL GROUP BY level;\n`;
    
    fs.writeFileSync(sqlFile, sql);
    console.log(`💾 Improved SQL update saved to: ${sqlFile}`);
    
    return sqlFile;
  }

  generateSummaryReport() {
    console.log('\n📊 Generating improved topic naming report...');
    
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
    const reportFile = `/Users/brandoncullum/video-scripter/exports/improved-topic-analysis-${timestamp}.md`;
    
    let report = `# Improved BERTopic Topic Naming Analysis\n\n`;
    report += `**Generated by Claude Code**: ${new Date().toISOString()}\n\n`;
    report += `## Overview - Much Cleaner Results! 🎉\n\n`;
    report += `This analysis shows dramatically improved topic clustering with clean content themes.\n\n`;
    
    for (const [levelName, levelNames] of Object.entries(this.topicNames)) {
      const levelData = this.results[levelName];
      report += `### ${levelName}\n\n`;
      report += `- **Total Topics**: ${levelData.actual_clusters}\n`;
      report += `- **Target Range**: ${levelData.target_clusters}\n`;
      report += `- **Average Size**: ${levelData.cluster_distribution.avg_size} videos\n`;
      report += `- **Size Range**: ${levelData.cluster_distribution.min_size}-${levelData.cluster_distribution.max_size} videos\n\n`;
      
      report += `#### Top Topics by Video Count:\n\n`;
      
      // Sort by video count and show top 10
      const sortedTopics = levelData.topic_info
        .filter(t => t.Topic !== -1)
        .sort((a, b) => b.Count - a.Count)
        .slice(0, 10);
      
      for (const topic of sortedTopics) {
        const topicId = topic.Topic;
        const name = levelNames[topicId];
        const keywords = levelData.top_words_per_topic[topicId]?.slice(0, 3).join(', ') || '';
        report += `- **${name}** (Topic ${topicId}): ${topic.Count} videos - \`${keywords}\`\n`;
      }
      report += `\n`;
    }
    
    report += `## Key Improvements 🚀\n\n`;
    report += `1. **Perfect Level 1**: 6 broad domains (vs previous 39) - exactly what we wanted!\n`;
    report += `2. **Clean Content Themes**: No more "Episodes" or format confusion\n`;
    report += `3. **Proper Hierarchy**: True broad → niche → micro progression\n`;
    report += `4. **Realistic Sizes**: Level 1 clusters range from 567-34,263 videos\n`;
    report += `5. **Content-Focused**: Clusters based on what people make, not how they present it\n\n`;
    
    report += `## Content Strategy Insights 💡\n\n`;
    report += `### Dominant Categories:\n`;
    report += `- **Woodworking dominates** with 34K+ videos (60% of dataset)\n`;
    report += `- **3D Printing** is second largest maker category\n`;
    report += `- **Food content** represents significant opportunity\n`;
    report += `- **Laser engraving** is a distinct, growing niche\n\n`;
    
    report += `### Content Gaps & Opportunities:\n`;
    report += `- Electronics/Arduino projects (likely underrepresented)\n`;
    report += `- Automotive/mechanical work (would appear with more diverse channels)\n`;
    report += `- Art/design projects (beyond cosplay)\n`;
    report += `- Home automation/smart home content\n\n`;
    
    report += `## Next Steps 📋\n\n`;
    report += `1. **Apply names to database**: Run the generated SQL update\n`;
    report += `2. **Import video assignments**: Use improved results for video categorization\n`;
    report += `3. **Content strategy**: Use these insights for channel discovery and content planning\n`;
    report += `4. **Expand dataset**: Add more diverse maker channels to fill content gaps\n\n`;
    
    fs.writeFileSync(reportFile, report);
    console.log(`📋 Improved analysis report saved to: ${reportFile}`);
    
    return reportFile;
  }

  run() {
    console.log('🚀 Starting Improved Topic Naming Analysis with Claude Code\n');
    
    this.loadResults();
    this.analyzeAllTopics();
    
    const sqlFile = this.generateSQLUpdate();
    const reportFile = this.generateSummaryReport();
    
    console.log('\n✅ Improved topic naming analysis complete!\n');
    console.log('📋 Summary of improvements:');
    console.log('   🎯 Level 1: 6 clean broad domains (perfect!)');
    console.log('   🎯 Level 2: 113 specific niches');
    console.log('   🎯 Level 3: 456 micro-techniques');
    console.log('   🚫 No more format/episode confusion');
    console.log('   ✨ Content-focused categorization\n');
    
    console.log('📋 Next steps:');
    console.log(`   1. Review the analysis: ${reportFile}`);
    console.log(`   2. Apply names to database: Run the SQL file in Supabase`);
    console.log(`   3. Import improved video assignments`);
    console.log(`   4. Use insights for content strategy\n`);
  }
}

// Run the improved analyzer
const analyzer = new ImprovedTopicNamingAnalyzer();
analyzer.run();
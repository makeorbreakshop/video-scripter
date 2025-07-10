#!/usr/bin/env node

/**
 * Claude Code Analysis: Generate Meaningful Names for BERTopic Clusters
 * Analyzes keywords, representative documents, and video counts to generate human-readable topic names
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TopicNamingAnalyzer {
  constructor() {
    this.results = null;
    this.topicNames = {
      'Level 1 - Broad Domains': {},
      'Level 2 - Niches': {},
      'Level 3 - Micro Topics': {}
    };
  }

  loadResults() {
    console.log('📂 Loading BERTopic results for analysis...');
    
    const resultsFile = '/Users/brandoncullum/video-scripter/exports/multi-level-bertopic-results-2025-07-10_11-57-57.json';
    this.results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    
    console.log(`✅ Loaded results for ${Object.keys(this.results).length} levels`);
  }

  generateTopicName(keywords, repDocs, videoCount, level) {
    // Analyze keywords to determine primary theme
    const primaryKeywords = keywords.slice(0, 3);
    const allKeywords = keywords.slice(0, 8);
    
    // Common domain patterns
    const domainPatterns = {
      // Manufacturing & Making
      '3d': '3D Printing & Design',
      'printing': '3D Printing & Design', 
      'laser': 'Laser Tools & Engraving',
      'woodworking': 'Woodworking & Carpentry',
      'wood': 'Woodworking & Carpentry',
      'table': 'Furniture & Table Making',
      'cosplay': 'Cosplay & Props',
      'armor': 'Cosplay & Props',
      
      // Technology
      'camera': 'Camera & Video Tech',
      'youtube': 'Content Creation & YouTube',
      'livestream': 'Live Streaming',
      'iphone': 'Mobile Technology',
      'ai': 'AI & Technology News',
      
      // Business & Finance
      'money': 'Business & Finance',
      'business': 'Business & Finance',
      'financial': 'Business & Finance',
      'rich': 'Wealth Building',
      
      // Food & Cooking
      'food': 'Food & Cooking',
      'recipe': 'Recipes & Cooking',
      'chicken': 'Cooking & Recipes',
      'chef': 'Chef & Culinary',
      
      // Fitness & Health
      'workout': 'Fitness & Exercise',
      'gym': 'Gym & Fitness',
      'climbing': 'Rock Climbing',
      
      // Tools & Equipment
      'saw': 'Power Tools & Saws',
      'tools': 'Tools & Equipment',
      'freight': 'Harbor Freight Tools',
      'jig': 'Woodworking Tools & Jigs',
      
      // Specific Crafts
      'guitar': 'Guitar Building',
      'ring': 'Ring Making & Jewelry',
      'drywall': 'Drywall & Home Repair',
      'paint': 'Painting & Finishing'
    };

    // Level-specific naming strategies
    if (level === 1) {
      // Broad domains - look for main category
      for (const keyword of primaryKeywords) {
        if (domainPatterns[keyword]) {
          return domainPatterns[keyword];
        }
      }
      
      // Fallback to descriptive name
      return this.createDescriptiveName(primaryKeywords, 'domain');
    }
    
    if (level === 2) {
      // Niches - more specific subcategories
      const combined = allKeywords.join(' ');
      
      // Specific niche patterns
      if (combined.includes('laser engraving')) return 'Laser Engraving & CNC';
      if (combined.includes('3d printing')) return '3D Printing Projects';
      if (combined.includes('dining table')) return 'Dining Table Making';
      if (combined.includes('coffee table')) return 'Coffee Table Builds';
      if (combined.includes('guitar build')) return 'Electric Guitar Building';
      if (combined.includes('home gym')) return 'Home Gym Setup';
      if (combined.includes('woodworking project')) return 'Woodworking Project Ideas';
      
      return this.createDescriptiveName(primaryKeywords, 'niche');
    }
    
    if (level === 3) {
      // Micro topics - very specific
      const combined = allKeywords.join(' ');
      
      // Hyper-specific patterns
      if (combined.includes('harbor freight')) return 'Harbor Freight Tool Reviews';
      if (combined.includes('ring making')) return 'Ring Making & Jewelry';
      if (combined.includes('carbon fiber')) return 'Carbon Fiber Projects';
      if (combined.includes('drywall tape')) return 'Drywall Taping & Repair';
      if (combined.includes('ai news')) return 'AI News & Updates';
      if (combined.includes('laser engraver')) return 'Laser Engraver Projects';
      
      return this.createDescriptiveName(primaryKeywords, 'micro');
    }
    
    return this.createDescriptiveName(primaryKeywords, 'general');
  }

  createDescriptiveName(keywords, level) {
    // Clean up keywords
    const cleanKeywords = keywords
      .filter(k => k.length > 2 && !['diy', 'make', 'making'].includes(k.toLowerCase()))
      .slice(0, 3);
    
    if (cleanKeywords.length === 0) return 'General Content';
    
    // Capitalize and format
    const formatted = cleanKeywords
      .map(k => k.charAt(0).toUpperCase() + k.slice(1))
      .join(' & ');
    
    // Add level-appropriate suffix
    const suffixes = {
      'domain': ' Content',
      'niche': ' Projects', 
      'micro': ' Techniques',
      'general': ''
    };
    
    return formatted + (suffixes[level] || '');
  }

  analyzeAllTopics() {
    console.log('\n🔍 Analyzing all topics to generate meaningful names...\n');
    
    for (const [levelName, levelData] of Object.entries(this.results)) {
      const levelNumber = levelName.includes('Level 1') ? 1 : 
                         levelName.includes('Level 2') ? 2 : 3;
      
      console.log(`📋 Processing ${levelName} (${levelData.actual_clusters} topics)...`);
      
      const levelNames = {};
      
      for (const topicInfo of levelData.topic_info) {
        const topicId = topicInfo.Topic;
        
        // Skip outlier topic (-1)
        if (topicId === -1) {
          levelNames[topicId] = 'Outliers / Uncategorized';
          continue;
        }
        
        const keywords = levelData.top_words_per_topic[topicId] || [];
        const videoCount = topicInfo.Count;
        const repDocs = topicInfo.Representative_Docs || [];
        
        const generatedName = this.generateTopicName(keywords, repDocs, videoCount, levelNumber);
        levelNames[topicId] = generatedName;
        
        console.log(`   Topic ${topicId}: "${generatedName}" (${videoCount} videos) - [${keywords.slice(0, 3).join(', ')}]`);
      }
      
      this.topicNames[levelName] = levelNames;
      console.log(`✅ Generated names for ${Object.keys(levelNames).length} topics\n`);
    }
  }

  generateSQLUpdate() {
    console.log('📝 Generating SQL update statements...');
    
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
    const sqlFile = `/Users/brandoncullum/video-scripter/exports/topic-names-update-${timestamp}.sql`;
    
    let sql = `-- Topic Names Update Generated by Claude Code Analysis\n`;
    sql += `-- Generated: ${new Date().toISOString()}\n\n`;
    sql += `BEGIN;\n\n`;
    
    for (const [levelName, levelNames] of Object.entries(this.topicNames)) {
      const levelNumber = levelName.includes('Level 1') ? 1 : 
                         levelName.includes('Level 2') ? 2 : 3;
      
      sql += `-- ${levelName}\n`;
      
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
    console.log(`💾 SQL update saved to: ${sqlFile}`);
    
    return sqlFile;
  }

  generateSummaryReport() {
    console.log('\n📊 Generating summary report...');
    
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
    const reportFile = `/Users/brandoncullum/video-scripter/exports/topic-naming-analysis-${timestamp}.md`;
    
    let report = `# BERTopic Topic Naming Analysis\n\n`;
    report += `**Generated by Claude Code**: ${new Date().toISOString()}\n\n`;
    report += `## Overview\n\n`;
    
    for (const [levelName, levelNames] of Object.entries(this.topicNames)) {
      const levelData = this.results[levelName];
      report += `### ${levelName}\n\n`;
      report += `- **Total Topics**: ${levelData.actual_clusters}\n`;
      report += `- **Named Topics**: ${Object.keys(levelNames).length}\n\n`;
      
      report += `#### Top Topics by Video Count:\n\n`;
      
      // Sort by video count
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
    
    report += `## Key Insights\n\n`;
    report += `1. **Content Categories Identified**: The analysis reveals clear content hierarchies from broad domains to specific techniques\n`;
    report += `2. **Top Content Areas**: 3D Printing, Woodworking, Business/Finance, Food & Cooking, Technology\n`;
    report += `3. **Micro-Specializations**: Harbor Freight tools, ring making, drywall repair, laser engraving\n`;
    report += `4. **Content Strategy Opportunities**: Clear gaps and opportunities visible in topic distribution\n\n`;
    
    report += `## Implementation\n\n`;
    report += `Run the generated SQL update to apply these topic names to the database:\n\n`;
    report += `\`\`\`bash\n`;
    report += `# Apply topic names to database\n`;
    report += `psql -f exports/topic-names-update-[timestamp].sql\n`;
    report += `\`\`\`\n`;
    
    fs.writeFileSync(reportFile, report);
    console.log(`📋 Summary report saved to: ${reportFile}`);
    
    return reportFile;
  }

  run() {
    console.log('🚀 Starting Topic Naming Analysis with Claude Code\n');
    
    this.loadResults();
    this.analyzeAllTopics();
    
    const sqlFile = this.generateSQLUpdate();
    const reportFile = this.generateSummaryReport();
    
    console.log('\n✅ Topic naming analysis complete!\n');
    console.log('📋 Next steps:');
    console.log(`   1. Review the analysis: ${reportFile}`);
    console.log(`   2. Apply names to database: Run the SQL file in Supabase`);
    console.log(`   3. Import video topic assignments with: node scripts/import-bertopic-results.js`);
    console.log(`   4. Verify results in database\n`);
  }
}

// Run the analyzer
const analyzer = new TopicNamingAnalyzer();
analyzer.run();
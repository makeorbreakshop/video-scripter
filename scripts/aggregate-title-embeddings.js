import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function aggregateTitleEmbeddings() {
  const exportsDir = path.join(__dirname, '../exports');
  const outputFile = path.join(exportsDir, 'title-embeddings-aggregated.json');
  
  // Get all title embedding files
  const files = fs.readdirSync(exportsDir)
    .filter(file => file.startsWith('title-embeddings-') && file.endsWith('.json') && !file.includes('metadata-only'))
    .sort();
  
  console.log(`Found ${files.length} title embedding files to aggregate`);
  
  const aggregatedData = {
    export_info: {
      timestamp: new Date().toISOString(),
      total_vectors: 0,
      dimension: 512,
      source_files: files.length,
      type: 'aggregated_title_embeddings'
    },
    embeddings: []
  };
  
  const seenIds = new Set();
  let duplicates = 0;
  
  for (const file of files) {
    const filePath = path.join(exportsDir, file);
    console.log(`Processing: ${file}`);
    
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      if (data.vectors) {
        for (const item of data.vectors) {
          if (seenIds.has(item.id)) {
            duplicates++;
            continue;
          }
          
          seenIds.add(item.id);
          aggregatedData.embeddings.push(item);
        }
      }
    } catch (error) {
      console.error(`Error processing ${file}:`, error.message);
    }
  }
  
  aggregatedData.export_info.total_vectors = aggregatedData.embeddings.length;
  
  console.log(`\nAggregation complete:`);
  console.log(`- Total unique videos: ${aggregatedData.embeddings.length}`);
  console.log(`- Duplicates removed: ${duplicates}`);
  console.log(`- Dimension: ${aggregatedData.export_info.dimension}`);
  
  // Write aggregated file
  fs.writeFileSync(outputFile, JSON.stringify(aggregatedData, null, 2));
  console.log(`\nAggregated embeddings saved to: ${outputFile}`);
  
  // Also create a CSV version for BERTopic analysis
  const csvFile = path.join(exportsDir, 'title-embeddings-for-bertopic.csv');
  const csvLines = ['video_id,title,channel_name,view_count,performance_ratio,embedding'];
  
  for (const item of aggregatedData.embeddings) {
    const embedding = item.values.join(',');
    const title = (item.metadata.title || '').replace(/"/g, '""'); // Escape quotes
    const channelName = (item.metadata.channel_name || '').replace(/"/g, '""');
    
    csvLines.push(`"${item.id}","${title}","${channelName}",${item.metadata.view_count || 0},${item.metadata.performance_ratio || 1},"${embedding}"`);
  }
  
  fs.writeFileSync(csvFile, csvLines.join('\n'));
  console.log(`CSV file for BERTopic saved to: ${csvFile}`);
  
  return {
    totalVectors: aggregatedData.embeddings.length,
    duplicatesRemoved: duplicates,
    outputFile,
    csvFile
  };
}

// Run the aggregation
aggregateTitleEmbeddings()
  .then(result => {
    console.log('\n✅ Title embeddings aggregation completed successfully');
    console.log(`📊 Final dataset: ${result.totalVectors} unique videos`);
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error during aggregation:', error);
    process.exit(1);
  });
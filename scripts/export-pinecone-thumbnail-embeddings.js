/**
 * Export all thumbnail embeddings from Pinecone for clustering analysis
 * 
 * This script will:
 * 1. Connect to your Pinecone video-thumbnails index
 * 2. Show you the cost estimate
 * 3. Let you decide whether to proceed
 * 4. Export all vectors to JSON/CSV files for Python analysis
 */

const { Pinecone } = require('@pinecone-database/pinecone');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

class PineconeThumbnailExporter {
  constructor() {
    if (!process.env.PINECONE_API_KEY) {
      throw new Error('PINECONE_API_KEY environment variable is required');
    }

    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    
    // Use the thumbnail index name from the screenshot
    this.indexName = 'video-thumbnails';
  }

  /**
   * Get index statistics and cost estimate
   */
  async getStats() {
    console.log(`🔌 Connecting to Pinecone thumbnail index: ${this.indexName}`);
    
    const index = this.pinecone.index(this.indexName);
    const stats = await index.describeIndexStats();
    
    // Debug: Let's see the actual stats structure
    console.log('\n🔍 Raw stats object:', JSON.stringify(stats, null, 2));
    
    console.log('\n📊 Thumbnail Index Statistics:');
    console.log(`   Total vectors: ${stats.totalRecordCount || stats.totalVectorCount || 'undefined'}`);
    console.log(`   Dimensions: ${stats.dimension || 'undefined'}`);
    console.log(`   Index fullness: ${stats.indexFullness ? (stats.indexFullness * 100).toFixed(2) : 'undefined'}%`);
    
    // Get the vector count
    const vectorCount = stats.totalRecordCount || stats.totalVectorCount;
    const dimension = stats.dimension || 768; // CLIP embeddings are 768-dimensional
    
    if (!vectorCount || vectorCount === 0) {
      console.log('\n❌ No vectors found in thumbnail index');
      return null;
    }
    
    console.log('\n💰 Cost Estimate:');
    console.log('   Pinecone pricing: ~$0.0001 per 1000 read operations');
    console.log(`   Total read operations: ${vectorCount}`);
    console.log(`   Estimated cost: ~$${(vectorCount * 0.0001 / 1000).toFixed(4)}`);
    console.log('   (This is a rough estimate - actual costs may vary)');
    
    return {
      vectorCount,
      dimension,
      indexFullness: stats.indexFullness
    };
  }

  /**
   * Export all vectors using batched queries (Pinecone has 10k limit per query)
   */
  async exportAllVectors(vectorCount, dimension) {
    const index = this.pinecone.index(this.indexName);
    const maxBatchSize = 10000; // Pinecone's maximum
    
    console.log('\n🔄 Starting thumbnail export...');
    console.log('   Method: Using batched queries (Pinecone 10k limit)');
    
    if (!vectorCount || vectorCount === 0) {
      throw new Error(`Invalid vector count: ${vectorCount}`);
    }
    
    // Create a dummy query vector (all zeros) with correct dimension
    const dummyVector = new Array(dimension).fill(0);
    
    const allVectors = [];
    const totalBatches = Math.ceil(vectorCount / maxBatchSize);
    
    console.log(`   Total vectors to export: ${vectorCount}`);
    console.log(`   Batch size: ${maxBatchSize}`);
    console.log(`   Total batches: ${totalBatches}`);
    
    try {
      for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
        const batchSize = Math.min(maxBatchSize, vectorCount - (batchNum * maxBatchSize));
        
        console.log(`\n   📦 Batch ${batchNum + 1}/${totalBatches} - requesting ${batchSize} vectors...`);
        
        const queryResponse = await index.query({
          vector: dummyVector,
          topK: batchSize,
          includeMetadata: true,
          includeValues: true
        });

        const batchVectors = queryResponse.matches?.map(match => ({
          id: match.id,
          values: match.values,
          metadata: match.metadata,
          score: match.score
        })) || [];

        allVectors.push(...batchVectors);
        
        console.log(`   ✅ Retrieved ${batchVectors.length} vectors (total so far: ${allVectors.length})`);
        
        // Add a small delay between batches to be nice to the API
        if (batchNum < totalBatches - 1) {
          console.log('   ⏳ Waiting 1 second before next batch...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      console.log(`\n✅ Export complete! Retrieved ${allVectors.length} thumbnail vectors`);
      return allVectors;
      
    } catch (error) {
      console.error('\n❌ Export failed:', error.message);
      throw error;
    }
  }

  /**
   * Save vectors to multiple file formats
   */
  async saveVectors(vectors, vectorCount, dimension) {
    const timestamp = new Date().toISOString();
    const baseFilename = `thumbnail-embeddings-${timestamp}`;
    const exportsDir = path.join(process.cwd(), 'exports');
    
    // Ensure exports directory exists
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }
    
    console.log('\n💾 Saving thumbnail embeddings to files...');
    
    // 1. Save full data as JSON
    const fullJsonPath = path.join(exportsDir, `${baseFilename}.json`);
    const fullData = {
      export_info: {
        timestamp,
        total_vectors: vectorCount,
        dimension,
        index_name: this.indexName,
        batches_processed: Math.ceil(vectorCount / 10000),
        type: 'thumbnail_embeddings'
      },
      vectors: vectors
    };
    
    fs.writeFileSync(fullJsonPath, JSON.stringify(fullData, null, 2));
    const fullJsonSize = (fs.statSync(fullJsonPath).size / 1024 / 1024).toFixed(2);
    console.log(`   ✅ Full JSON: ${fullJsonPath} (${fullJsonSize} MB)`);
    
    // 2. Save metadata only (for quick inspection)
    const metadataPath = path.join(exportsDir, `${baseFilename.replace('thumbnail-embeddings', 'thumbnail-embeddings-metadata-only')}.json`);
    const metadataData = {
      export_info: fullData.export_info,
      metadata: vectors.map(v => ({
        id: v.id,
        metadata: v.metadata
      }))
    };
    
    fs.writeFileSync(metadataPath, JSON.stringify(metadataData, null, 2));
    const metadataSize = (fs.statSync(metadataPath).size / 1024 / 1024).toFixed(2);
    console.log(`   ✅ Metadata only: ${metadataPath} (${metadataSize} MB)`);
    
    // 3. Save as CSV for Python analysis
    const csvPath = path.join(exportsDir, `${baseFilename.replace('thumbnail-embeddings', 'thumbnail-embeddings-for-clustering')}.csv`);
    const csvHeaders = [
      'id',
      'embedding',
      'title',
      'channel_id', 
      'channel_name',
      'view_count',
      'published_at',
      'performance_ratio',
      'thumbnail_url',
      'embedding_version'
    ];
    
    const csvRows = vectors.map(v => {
      const metadata = v.metadata || {};
      return [
        v.id,
        v.values.join('|'), // Join embedding values with pipe separator
        (metadata.title || '').replace(/"/g, '""'), // Escape quotes
        metadata.channel_id || '',
        (metadata.channel_name || '').replace(/"/g, '""'), // Escape quotes
        metadata.view_count || 0,
        metadata.published_at || '',
        metadata.performance_ratio || 1.0,
        metadata.thumbnail_url || '',
        metadata.embedding_version || 'clip-vit-large-patch14'
      ].map(field => `"${field}"`).join(',');
    });
    
    const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');
    fs.writeFileSync(csvPath, csvContent);
    const csvSize = (fs.statSync(csvPath).size / 1024 / 1024).toFixed(2);
    console.log(`   ✅ CSV for clustering: ${csvPath} (${csvSize} MB)`);
    
    console.log('\n📁 Export Summary:');
    console.log(`   Total files created: 3`);
    console.log(`   Total vectors exported: ${vectors.length}`);
    console.log(`   Embedding dimension: ${dimension}`);
    console.log(`   Index: ${this.indexName}`);
    console.log(`   Timestamp: ${timestamp}`);
    
    return {
      fullJsonPath,
      metadataPath,
      csvPath,
      vectorCount: vectors.length
    };
  }

  /**
   * Main export function
   */
  async export() {
    try {
      console.log('🎯 Pinecone Thumbnail Embeddings Export');
      console.log('======================================\n');
      
      // Get stats and cost estimate
      const stats = await this.getStats();
      if (!stats) {
        console.log('❌ Cannot proceed with export - no thumbnail vectors found');
        return;
      }
      
      // Ask for confirmation
      console.log('\n❓ Do you want to proceed with the export?');
      console.log('   This will download all thumbnail embeddings from Pinecone.');
      console.log('   Type "yes" to continue, anything else to cancel:');
      
      // Simple confirmation (in real use, you'd want proper input handling)
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      return new Promise((resolve, reject) => {
        rl.question('> ', async (answer) => {
          rl.close();
          
          if (answer.toLowerCase() !== 'yes') {
            console.log('❌ Export cancelled');
            resolve();
            return;
          }
          
          try {
            // Export all vectors
            const vectors = await this.exportAllVectors(stats.vectorCount, stats.dimension);
            
            // Save to files
            const result = await this.saveVectors(vectors, stats.vectorCount, stats.dimension);
            
            console.log('\n🎉 Thumbnail embeddings export completed successfully!');
            console.log('\nNext steps:');
            console.log('1. Use the CSV file for Python clustering analysis');
            console.log('2. Run: python scripts/analyze-thumbnail-embeddings.py');
            console.log('3. Compare results with title embedding clusters');
            
            resolve(result);
          } catch (error) {
            console.error('\n❌ Export failed:', error.message);
            reject(error);
          }
        });
      });
      
    } catch (error) {
      console.error('❌ Export failed:', error.message);
      throw error;
    }
  }
}

// Run the export
if (require.main === module) {
  const exporter = new PineconeThumbnailExporter();
  exporter.export().catch(console.error);
}

module.exports = { PineconeThumbnailExporter };
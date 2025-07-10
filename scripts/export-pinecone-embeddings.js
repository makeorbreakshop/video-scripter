/**
 * Export all embeddings from Pinecone for clustering analysis
 * 
 * This script will:
 * 1. Connect to your Pinecone index
 * 2. Show you the cost estimate
 * 3. Let you decide whether to proceed
 * 4. Export all vectors to JSON file for Python analysis
 */

import { Pinecone } from '@pinecone-database/pinecone';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

class PineconeExporter {
  constructor() {
    if (!process.env.PINECONE_API_KEY) {
      throw new Error('PINECONE_API_KEY environment variable is required');
    }
    
    if (!process.env.PINECONE_INDEX_NAME) {
      throw new Error('PINECONE_INDEX_NAME environment variable is required');
    }

    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    
    this.indexName = process.env.PINECONE_INDEX_NAME;
  }

  /**
   * Get index statistics and cost estimate
   */
  async getStats() {
    console.log(`🔌 Connecting to Pinecone index: ${this.indexName}`);
    
    const index = this.pinecone.index(this.indexName);
    const stats = await index.describeIndexStats();
    
    // Debug: Let's see the actual stats structure
    console.log('\n🔍 Raw stats object:', JSON.stringify(stats, null, 2));
    
    console.log('\n📊 Index Statistics:');
    console.log(`   Total vectors: ${stats.totalRecordCount || stats.totalVectorCount || 'undefined'}`);
    console.log(`   Dimensions: ${stats.dimension || 'undefined'}`);
    console.log(`   Index fullness: ${stats.indexFullness ? (stats.indexFullness * 100).toFixed(2) : 'undefined'}%`);
    
    // Try to get vector count from main stats or namespaces
    let vectorCount = stats.totalRecordCount || stats.totalVectorCount;
    if (!vectorCount && stats.namespaces) {
      console.log('\n🔍 Checking namespaces for vector count...');
      vectorCount = 0;
      for (const [namespace, namespaceStats] of Object.entries(stats.namespaces)) {
        const namespaceCount = namespaceStats.recordCount || namespaceStats.vectorCount || 0;
        console.log(`   Namespace "${namespace}": ${namespaceCount} vectors`);
        vectorCount += namespaceCount;
      }
      console.log(`   Total from namespaces: ${vectorCount}`);
    }
    
    if (!vectorCount) {
      console.log('\n❌ Could not determine vector count from stats');
      console.log('   This might be an issue with the Pinecone API or index configuration');
      return stats;
    }
    
    // Cost estimate (rough)
    const estimatedCost = this.estimateCost(vectorCount);
    
    console.log('\n💰 Cost Estimate:');
    console.log(`   Vectors to export: ${vectorCount}`);
    console.log(`   Estimated cost: $${estimatedCost.min} - $${estimatedCost.max}`);
    console.log(`   Note: This is a rough estimate based on query operations`);
    
    return { ...stats, actualVectorCount: vectorCount };
  }

  /**
   * Rough cost estimation
   */
  estimateCost(vectorCount) {
    // Pinecone pricing is roughly $0.096 per 1M query operations
    // We'll need 1 large query operation for all vectors
    // Plus some overhead for the query processing
    
    const queryOps = 1; // One big query to get all vectors
    const costPerMillionOps = 0.096;
    const baseCost = (queryOps / 1000000) * costPerMillionOps;
    
    // Add some buffer for processing costs
    return {
      min: Math.max(0.01, baseCost * 0.5).toFixed(2),
      max: Math.max(0.05, baseCost * 5).toFixed(2)
    };
  }

  /**
   * Export all vectors using batched queries (Pinecone has 10k limit per query)
   */
  async exportAllVectors(vectorCount, dimension) {
    const index = this.pinecone.index(this.indexName);
    const maxBatchSize = 10000; // Pinecone's maximum
    
    console.log('\n🔄 Starting export...');
    console.log('   Method: Using batched queries (Pinecone 10k limit)');
    
    if (!vectorCount || vectorCount === 0) {
      throw new Error(`Invalid vector count: ${vectorCount}`);
    }
    
    // Create a dummy query vector (all zeros)
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
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`\n✅ Export complete! Retrieved ${allVectors.length} total vectors`);
      
      // Format the data for easy Python consumption
      const exportData = {
        export_info: {
          timestamp: new Date().toISOString(),
          total_vectors: allVectors.length,
          dimension: dimension,
          index_name: this.indexName,
          batches_processed: totalBatches
        },
        vectors: allVectors
      };

      return exportData;
    } catch (error) {
      console.error('❌ Export failed:', error);
      throw error;
    }
  }

  /**
   * Save exported data to files
   */
  async saveToFiles(exportData) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(__dirname, '../exports');
    
    // Create exports directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save full data as JSON
    const jsonPath = path.join(outputDir, `pinecone-embeddings-${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));
    console.log(`💾 Saved full data to: ${jsonPath}`);

    // Save just the embeddings as CSV-like format for Python
    const csvPath = path.join(outputDir, `embeddings-for-clustering-${timestamp}.csv`);
    let csvContent = 'video_id,title,channel_name,view_count,performance_ratio,embedding\n';
    
    exportData.vectors.forEach(vector => {
      const metadata = vector.metadata || {};
      const embedding = vector.values.join('|'); // Use pipe separator for embedding array
      csvContent += `"${vector.id}","${metadata.title || ''}","${metadata.channel_name || ''}",${metadata.view_count || 0},${metadata.performance_ratio || 0},"${embedding}"\n`;
    });
    
    fs.writeFileSync(csvPath, csvContent);
    console.log(`📊 Saved clustering data to: ${csvPath}`);

    // Save metadata only for quick analysis
    const metadataPath = path.join(outputDir, `metadata-only-${timestamp}.json`);
    const metadataOnly = {
      export_info: exportData.export_info,
      metadata: exportData.vectors.map(v => ({
        id: v.id,
        metadata: v.metadata
      }))
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadataOnly, null, 2));
    console.log(`📋 Saved metadata to: ${metadataPath}`);

    return { jsonPath, csvPath, metadataPath };
  }

  /**
   * Interactive export process
   */
  async run() {
    try {
      console.log('🚀 Pinecone Embedding Exporter\n');
      
      // Get stats and cost estimate
      const stats = await this.getStats();
      
      // Ask for confirmation
      console.log('\n❓ Do you want to proceed with the export?');
      console.log('   This will incur the estimated cost shown above.');
      console.log('   Press Ctrl+C to cancel, or press Enter to continue...');
      
      // Wait for user input
      await new Promise(resolve => {
        process.stdin.once('data', () => resolve());
      });
      
      console.log('\n✅ Proceeding with export...');
      
      // Export the data
      const vectorCount = stats.actualVectorCount || stats.totalRecordCount || stats.totalVectorCount;
      const dimension = stats.dimension || 512; // Default to 512 if undefined
      
      console.log(`🔍 Debug: vectorCount=${vectorCount}, dimension=${dimension}`);
      
      if (!vectorCount) {
        console.error('❌ Cannot proceed: Unable to determine vector count');
        return;
      }
      
      const exportData = await this.exportAllVectors(vectorCount, dimension);
      
      // Save to files
      const filePaths = await this.saveToFiles(exportData);
      
      console.log('\n🎉 Export completed successfully!');
      console.log('\nFiles created:');
      console.log(`   📄 Full data: ${filePaths.jsonPath}`);
      console.log(`   📊 For clustering: ${filePaths.csvPath}`);
      console.log(`   📋 Metadata only: ${filePaths.metadataPath}`);
      
      console.log('\n🐍 For Python analysis, use the CSV file with pandas:');
      console.log('   import pandas as pd');
      console.log(`   df = pd.read_csv("${filePaths.csvPath}")`);
      console.log('   # Convert embedding column back to numpy array');
      console.log('   df["embedding"] = df["embedding"].str.split("|").apply(lambda x: np.array([float(i) for i in x]))');
      
    } catch (error) {
      console.error('❌ Export failed:', error);
      process.exit(1);
    }
  }
}

// Run the exporter
const exporter = new PineconeExporter();
exporter.run();

export default PineconeExporter;
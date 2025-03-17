/**
 * Comment Chunker
 * Implements keyword-based clustering for YouTube comments
 */

// Define interfaces for comment processing
export interface YouTubeComment {
  textDisplay: string;
  authorDisplayName: string;
  likeCount: number;
  publishedAt: string;
  updatedAt?: string;
  videoTimestampSec?: number;
}

export interface CommentCluster {
  content: string;            // Combined text of comments in cluster
  keywords: string[];         // Top keywords that define this cluster
  commentCount: number;       // Number of comments in the cluster
  hasTimestampReferences: boolean; // Whether any comments reference timestamps
  authorCount: number;        // Count of unique authors in cluster
  averageLikeCount: number;   // Average likes per comment
  timestamps?: number[];      // Timestamps referenced, if any
  representativeComments: string[]; // Sample of key comments in this cluster (max 3)
}

// Word frequency counter
interface WordFrequency {
  [word: string]: number;
}

// Stop words to exclude from keyword extraction
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'by', 
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 
  'does', 'did', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might',
  'must', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 
  'them', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our',
  'their', 'mine', 'yours', 'his', 'hers', 'ours', 'theirs', 'in', 'of', 'with',
  'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'from', 'up', 'down', 'so', 'than', 'very', 'just', 'more', 'most',
  'other', 'some', 'such', 'no', 'not', 'only', 'same', 'too', 'also'
]);

/**
 * Clean text for keyword extraction
 * Removes punctuation, converts to lowercase, removes stopwords
 */
function cleanTextForKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .split(/\s+/) // Split on whitespace
    .filter(word => 
      word.length > 2 && // Skip very short words
      !STOP_WORDS.has(word) && // Skip stopwords
      !(/^\d+$/.test(word)) // Skip numbers-only words
    );
}

/**
 * Extract keywords from a comment
 * Returns an array of significant words from the comment
 */
function extractKeywords(comment: string): string[] {
  return cleanTextForKeywords(comment);
}

/**
 * Detect if a comment references a specific timestamp in the video
 * Returns the timestamp in seconds if found, or null
 */
function extractTimestamp(comment: string): number | null {
  // Match common timestamp formats (HH:MM:SS, MM:SS, or just a number of seconds)
  const timestampRegex = /(?:^|\s)(?:(?:(\d+):)?(\d+):(\d+)|(\d+)s)(?:\s|$)/;
  const match = comment.match(timestampRegex);
  
  if (match) {
    if (match[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      // Format: HH:MM:SS
      const hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const seconds = parseInt(match[3]);
      return hours * 3600 + minutes * 60 + seconds;
    } else if (match[2] !== undefined && match[3] !== undefined) {
      // Format: MM:SS
      const minutes = parseInt(match[2]);
      const seconds = parseInt(match[3]);
      return minutes * 60 + seconds;
    } else if (match[4] !== undefined) {
      // Format: Xs
      return parseInt(match[4]);
    }
  }
  
  return null;
}

/**
 * Find the most common words in a collection of comments
 * Returns an array of the top N keywords with their frequencies
 */
function findTopKeywords(comments: YouTubeComment[], topN: number = 5): string[] {
  const wordFrequency: WordFrequency = {};
  
  // Extract and count all keywords from all comments
  comments.forEach(comment => {
    const keywords = extractKeywords(comment.textDisplay);
    keywords.forEach(word => {
      wordFrequency[word] = (wordFrequency[word] || 0) + 1;
    });
  });
  
  // Sort words by frequency
  const sortedWords = Object.entries(wordFrequency)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);
  
  return sortedWords.slice(0, topN);
}

/**
 * Calculate keyword similarity between a comment and a set of keywords
 * Returns a similarity score between 0 and 1
 */
function calculateKeywordSimilarity(comment: string, keywords: string[]): number {
  const commentKeywords = new Set(extractKeywords(comment));
  if (commentKeywords.size === 0) return 0;
  
  // Count how many of the target keywords are in the comment
  const matchCount = keywords.filter(keyword => commentKeywords.has(keyword)).length;
  
  // Calculate similarity score
  return matchCount / Math.max(keywords.length, 1);
}

/**
 * Cluster comments based on keyword similarity
 * Groups comments with similar themes and topics
 */
export function clusterCommentsByKeywords(
  comments: YouTubeComment[],
  options: {
    similarityThreshold?: number; // Minimum similarity to include in a cluster (0-1)
    maxClusters?: number;         // Maximum number of clusters to create
    minCommentsPerCluster?: number; // Minimum comments required to form a cluster
  } = {}
): CommentCluster[] {
  const {
    similarityThreshold = 0.3,
    maxClusters = 10,
    minCommentsPerCluster = 3
  } = options;
  
  if (!comments || comments.length === 0) {
    return [];
  }
  
  // If not enough comments to form any meaningful clusters
  if (comments.length < minCommentsPerCluster) {
    const allKeywords = findTopKeywords(comments, 5);
    const timestampRefs = comments.map(c => extractTimestamp(c.textDisplay)).filter(Boolean) as number[];
    const uniqueAuthors = new Set(comments.map(c => c.authorDisplayName));
    const avgLikes = comments.reduce((sum, c) => sum + c.likeCount, 0) / comments.length;
    
    return [{
      content: comments.map(c => c.textDisplay).join('\n\n'),
      keywords: allKeywords,
      commentCount: comments.length,
      hasTimestampReferences: timestampRefs.length > 0,
      authorCount: uniqueAuthors.size,
      averageLikeCount: avgLikes,
      timestamps: timestampRefs.length > 0 ? timestampRefs : undefined,
      representativeComments: comments.slice(0, 3).map(c => c.textDisplay)
    }];
  }
  
  // Find representative comments
  const likedComments = [...comments].sort((a, b) => b.likeCount - a.likeCount);
  const seedComments = likedComments.slice(0, Math.min(maxClusters, Math.ceil(comments.length / minCommentsPerCluster)));
  
  // Create clusters around seed comments
  const clusters: {
    seed: YouTubeComment;
    members: YouTubeComment[];
    keywords: string[];
  }[] = [];
  
  // Extract initial keywords from seed comments
  for (const seed of seedComments) {
    // Get initial keyword set from the seed comment
    const initialKeywords = extractKeywords(seed.textDisplay);
    if (initialKeywords.length === 0) continue; // Skip if no meaningful keywords
    
    clusters.push({
      seed,
      members: [seed],
      keywords: initialKeywords
    });
  }
  
  // If we couldn't create any valid initial clusters
  if (clusters.length === 0) {
    // Fallback: Create one cluster with all comments
    return [{
      content: comments.map(c => c.textDisplay).join('\n\n'),
      keywords: findTopKeywords(comments, 5),
      commentCount: comments.length,
      hasTimestampReferences: comments.some(c => extractTimestamp(c.textDisplay) !== null),
      authorCount: new Set(comments.map(c => c.authorDisplayName)).size,
      averageLikeCount: comments.reduce((sum, c) => sum + c.likeCount, 0) / comments.length,
      timestamps: comments.map(c => extractTimestamp(c.textDisplay)).filter(Boolean) as number[],
      representativeComments: comments.slice(0, 3).map(c => c.textDisplay)
    }];
  }
  
  // Assign each non-seed comment to the most similar cluster
  const unassignedComments = comments.filter(c => !seedComments.includes(c));
  
  for (const comment of unassignedComments) {
    let bestClusterIndex = -1;
    let highestSimilarity = similarityThreshold - 0.01; // Must exceed threshold
    
    // Find the most similar cluster
    for (let i = 0; i < clusters.length; i++) {
      const similarity = calculateKeywordSimilarity(comment.textDisplay, clusters[i].keywords);
      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestClusterIndex = i;
      }
    }
    
    // Assign to the best cluster if one was found
    if (bestClusterIndex !== -1) {
      clusters[bestClusterIndex].members.push(comment);
    } else {
      // Comment didn't match any cluster well enough
      // Could create a new cluster if needed, but we'll skip for simplicity
    }
  }
  
  // Filter out clusters with too few comments
  const validClusters = clusters.filter(cluster => 
    cluster.members.length >= minCommentsPerCluster);
  
  // Convert internal cluster format to the expected output format
  return validClusters.map(cluster => {
    // Refresh keywords based on all cluster members
    const keywords = findTopKeywords(cluster.members, 5);
    const allText = cluster.members.map(c => c.textDisplay).join('\n\n');
    const timestampRefs = cluster.members
      .map(c => extractTimestamp(c.textDisplay))
      .filter(Boolean) as number[];
    const uniqueAuthors = new Set(cluster.members.map(c => c.authorDisplayName));
    const avgLikes = cluster.members.reduce((sum, c) => sum + c.likeCount, 0) / cluster.members.length;
    
    // Find most representative comments (highest likes and best keyword match)
    const representativeComments = [...cluster.members]
      .sort((a, b) => {
        // Sort by combination of likes and keyword match
        const aKeywordScore = calculateKeywordSimilarity(a.textDisplay, keywords);
        const bKeywordScore = calculateKeywordSimilarity(b.textDisplay, keywords);
        return (b.likeCount * bKeywordScore) - (a.likeCount * aKeywordScore);
      })
      .slice(0, 3)
      .map(c => c.textDisplay);
    
    return {
      content: allText,
      keywords,
      commentCount: cluster.members.length,
      hasTimestampReferences: timestampRefs.length > 0,
      authorCount: uniqueAuthors.size,
      averageLikeCount: avgLikes,
      timestamps: timestampRefs.length > 0 ? timestampRefs : undefined,
      representativeComments
    };
  });
}

/**
 * Main entry point for processing YouTube comments
 * Creates semantically meaningful clusters from a set of comments
 */
export function processComments(
  comments: YouTubeComment[],
  options: {
    similarityThreshold?: number;
    maxClusters?: number;
    minCommentsPerCluster?: number;
  } = {}
): CommentCluster[] {
  if (!comments || comments.length === 0) {
    return [];
  }
  
  return clusterCommentsByKeywords(comments, options);
}

// New imports for OpenAI-based clustering
import { getOpenAIApiKey } from "./env-config";
import OpenAI from 'openai';

/**
 * Cluster comments using OpenAI embeddings for better semantic grouping
 * This provides much more accurate clustering than keyword-based methods
 */
export async function clusterCommentsWithEmbeddings(
  comments: YouTubeComment[],
  options: {
    maxClusters?: number;
    minCommentsPerCluster?: number;
  } = {}
): Promise<CommentCluster[]> {
  const {
    maxClusters = 10,
    minCommentsPerCluster = 3
  } = options;
  
  if (!comments || comments.length === 0) {
    return [];
  }
  
  // If not enough comments to form meaningful clusters
  if (comments.length < minCommentsPerCluster) {
    return createSingleCluster(comments);
  }
  
  try {
    // Get OpenAI API key
    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      console.warn("OpenAI API key not found, falling back to keyword-based clustering");
      return clusterCommentsByKeywords(comments, options);
    }
    
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: apiKey
    });
    
    // Generate embeddings for all comments
    console.log(`🧠 Generating embeddings for ${comments.length} comments`);
    
    // Clean and validate comments
    const commentTexts = comments.map(c => {
      const cleaned = cleanHtmlContent(c.textDisplay);
      // Truncate very long comments to avoid token limits
      return cleaned.length > 8000 ? cleaned.substring(0, 8000) + "..." : cleaned;
    })
    // Filter out empty comments
    .filter(text => text.trim().length > 0);
    
    // Set a reasonable batch size to avoid token limits
    const BATCH_SIZE = 100;
    const totalBatches = Math.ceil(commentTexts.length / BATCH_SIZE);
    console.log(`🔄 Processing ${commentTexts.length} texts in ${totalBatches} batches with OpenAI`);
    
    // Process embeddings in batches
    let allEmbeddings: number[][] = [];
    let validComments: YouTubeComment[] = [];
    let validCommentIndices: number[] = [];
    
    for (let i = 0; i < commentTexts.length; i += BATCH_SIZE) {
      const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`⏳ Processing batch ${batchIndex}/${totalBatches} with ${Math.min(BATCH_SIZE, commentTexts.length - i)} texts`);
      
      const batchTexts = commentTexts.slice(i, i + BATCH_SIZE);
      const batchComments = comments.slice(i, i + BATCH_SIZE);
      
      try {
        // Create a sub-batch to avoid token limits if needed
        // OpenAI allows batching embeddings in a single call, so let's use that capability
        const SUB_BATCH_SIZE = 20; // Process 20 comments at a time instead of 1
        
        for (let j = 0; j < batchTexts.length; j += SUB_BATCH_SIZE) {
          const subBatchEndIndex = Math.min(j + SUB_BATCH_SIZE, batchTexts.length);
          const subBatchTexts = batchTexts.slice(j, subBatchEndIndex).filter(text => text.trim().length > 0);
          
          if (subBatchTexts.length === 0) continue;
          
          console.log(`🧠 Generating embeddings for ${subBatchTexts.length} text chunks using OpenAI`);
          
          // Process multiple texts in a single API call
          const embeddingResponse = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: subBatchTexts,
            dimensions: 256 // Smaller dimension is sufficient for clustering
          });
          
          if (embeddingResponse.data && embeddingResponse.data.length > 0) {
            // Process each embedding in the response
            for (let k = 0; k < embeddingResponse.data.length; k++) {
              const validTextIndex = j + k;
              if (validTextIndex < batchTexts.length && batchTexts[validTextIndex].trim().length > 0) {
                allEmbeddings.push(embeddingResponse.data[k].embedding);
                validComments.push(batchComments[validTextIndex]);
                validCommentIndices.push(i + validTextIndex);
              }
            }
            console.log(`✅ Successfully generated ${embeddingResponse.data.length} embeddings`);
          }
        }
      } catch (batchError) {
        console.error(`🚨 Error processing batch ${batchIndex}: ${batchError}`);
        // Continue with the next batch
      }
      
      console.log(`✅ Batch ${batchIndex}/${totalBatches} completed`);
    }
    
    if (allEmbeddings.length < minCommentsPerCluster) {
      console.warn(`⚠️ Not enough valid embeddings (${allEmbeddings.length}), falling back to keyword clustering`);
      return clusterCommentsByKeywords(comments, options);
    }
    
    // Perform k-means clustering on the embeddings
    const clusters = await performKMeansClustering(
      allEmbeddings, 
      Math.min(maxClusters, Math.ceil(validComments.length / minCommentsPerCluster))
    );
    
    // Group comments by cluster
    const commentClusters: YouTubeComment[][] = Array(clusters.k).fill(null).map(() => []);
    
    clusters.assignments.forEach((clusterIndex, embeddingIndex) => {
      commentClusters[clusterIndex].push(validComments[embeddingIndex]);
    });
    
    // Filter out clusters that are too small
    const validClusters = commentClusters
      .filter(cluster => cluster.length >= minCommentsPerCluster)
      .map(cluster => formatCluster(cluster));
    
    console.log(`✅ Created ${validClusters.length} semantic clusters from ${validComments.length} comments`);
    return validClusters;
  } catch (error) {
    console.error("Error in embedding-based clustering:", error);
    console.log("Falling back to keyword-based clustering");
    return clusterCommentsByKeywords(comments, options);
  }
}

/**
 * Clean HTML content from comments
 */
function cleanHtmlContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&[^;]+;/g, match => { // Replace HTML entities
      switch (match) {
        case '&amp;': return '&';
        case '&lt;': return '<';
        case '&gt;': return '>';
        case '&quot;': return '"';
        case '&#39;': return "'";
        default: return match;
      }
    })
    .trim();
}

/**
 * Perform k-means clustering on embeddings
 * A simple implementation of k-means for clustering comment embeddings
 */
async function performKMeansClustering(
  embeddings: number[][],
  k: number
): Promise<{ k: number; assignments: number[]; centroids: number[][] }> {
  // If we have fewer embeddings than clusters, adjust k
  if (embeddings.length < k) {
    k = embeddings.length;
  }
  
  // Initialize centroids randomly
  const centroids: number[][] = [];
  const usedIndices = new Set<number>();
  
  for (let i = 0; i < k; i++) {
    let randomIndex;
    do {
      randomIndex = Math.floor(Math.random() * embeddings.length);
    } while (usedIndices.has(randomIndex));
    
    usedIndices.add(randomIndex);
    centroids.push([...embeddings[randomIndex]]);
  }
  
  // Maximum iterations to prevent infinite loops
  const maxIterations = 100;
  let iterations = 0;
  let assignments: number[] = [];
  let oldAssignments: number[] = Array(embeddings.length).fill(-1);
  
  // Iterate until convergence or max iterations
  while (iterations < maxIterations) {
    // Assign each point to nearest centroid
    assignments = embeddings.map(embedding => {
      let minDistance = Infinity;
      let closestCentroid = 0;
      
      for (let i = 0; i < centroids.length; i++) {
        const distance = calculateCosineSimilarity(embedding, centroids[i]);
        if (distance < minDistance) {
          minDistance = distance;
          closestCentroid = i;
        }
      }
      
      return closestCentroid;
    });
    
    // Check for convergence
    if (arraysEqual(assignments, oldAssignments)) {
      break;
    }
    
    // Update centroids
    for (let i = 0; i < k; i++) {
      const clusterPoints = embeddings.filter((_, index) => assignments[index] === i);
      
      if (clusterPoints.length > 0) {
        // Calculate new centroid as average of points
        const newCentroid = Array(clusterPoints[0].length).fill(0);
        
        for (const point of clusterPoints) {
          for (let j = 0; j < point.length; j++) {
            newCentroid[j] += point[j];
          }
        }
        
        for (let j = 0; j < newCentroid.length; j++) {
          newCentroid[j] /= clusterPoints.length;
        }
        
        // Normalize the centroid
        const norm = Math.sqrt(newCentroid.reduce((sum, val) => sum + val * val, 0));
        for (let j = 0; j < newCentroid.length; j++) {
          newCentroid[j] /= norm;
        }
        
        centroids[i] = newCentroid;
      }
    }
    
    oldAssignments = [...assignments];
    iterations++;
  }
  
  return { k, assignments, centroids };
}

/**
 * Calculate cosine similarity between two vectors
 * Returns a value between 0 and 2, where 0 is most similar
 */
function calculateCosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  // Cosine distance = 1 - cosine similarity
  return 1 - (dotProduct / (normA * normB));
}

/**
 * Check if two arrays are equal
 */
function arraysEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Create a single cluster from all comments
 */
function createSingleCluster(comments: YouTubeComment[]): CommentCluster[] {
  const allKeywords = findTopKeywords(comments, 5);
  const timestampRefs = comments.map(c => extractTimestamp(c.textDisplay)).filter(Boolean) as number[];
  const uniqueAuthors = new Set(comments.map(c => c.authorDisplayName));
  const avgLikes = comments.reduce((sum, c) => sum + c.likeCount, 0) / comments.length;
  
  return [{
    content: comments.map(c => cleanHtmlContent(c.textDisplay)).join('\n\n'),
    keywords: allKeywords,
    commentCount: comments.length,
    hasTimestampReferences: timestampRefs.length > 0,
    authorCount: uniqueAuthors.size,
    averageLikeCount: avgLikes,
    timestamps: timestampRefs.length > 0 ? timestampRefs : undefined,
    representativeComments: comments.slice(0, 3).map(c => cleanHtmlContent(c.textDisplay))
  }];
}

/**
 * Format a cluster of comments into the CommentCluster format
 */
function formatCluster(cluster: YouTubeComment[]): CommentCluster {
  const keywords = findTopKeywords(cluster, 5);
  const allText = cluster.map(c => cleanHtmlContent(c.textDisplay)).join('\n\n');
  const timestampRefs = cluster
    .map(c => extractTimestamp(c.textDisplay))
    .filter(Boolean) as number[];
  const uniqueAuthors = new Set(cluster.map(c => c.authorDisplayName));
  const avgLikes = cluster.reduce((sum, c) => sum + c.likeCount, 0) / cluster.length;
  
  // Find most representative comments (highest likes and best keyword match)
  const representativeComments = [...cluster]
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, 3)
    .map(c => cleanHtmlContent(c.textDisplay));
  
  return {
    content: allText,
    keywords,
    commentCount: cluster.length,
    hasTimestampReferences: timestampRefs.length > 0,
    authorCount: uniqueAuthors.size,
    averageLikeCount: avgLikes,
    timestamps: timestampRefs.length > 0 ? timestampRefs : undefined,
    representativeComments
  };
}

/**
 * Enhanced comment processing function that uses OpenAI embeddings
 * for semantic clustering when available
 */
export async function processCommentsEnhanced(
  comments: YouTubeComment[],
  options: {
    similarityThreshold?: number;
    maxClusters?: number;
    minCommentsPerCluster?: number;
    useEmbeddings?: boolean;
  } = {}
): Promise<CommentCluster[]> {
  if (!comments || comments.length === 0) {
    return [];
  }
  
  const { useEmbeddings = true } = options;
  
  if (useEmbeddings) {
    try {
      return await clusterCommentsWithEmbeddings(comments, options);
    } catch (error) {
      console.error("Error in embedding-based clustering:", error);
      console.log("Falling back to keyword-based clustering");
    }
  }
  
  // Fallback to keyword-based clustering
  return clusterCommentsByKeywords(comments, options);
} 
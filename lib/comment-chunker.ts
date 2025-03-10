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
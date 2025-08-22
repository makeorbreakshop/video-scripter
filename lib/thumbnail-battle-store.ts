// Simple in-memory store for thumbnail battle matchups
// In production, this should use Redis or database storage

interface MatchupData {
  winner: 'A' | 'B';
  videoA_score: number;
  videoB_score: number;
  created_at: number;
  start_time: number;
}

// Store matchups in memory (will reset on server restart)
const matchupStore = new Map<string, MatchupData>();

// Clean up old matchups after 10 minutes
const MATCHUP_TTL = 10 * 60 * 1000; // 10 minutes

export function storeMatchup(
  matchupId: string,
  winner: 'A' | 'B',
  videoA_score: number,
  videoB_score: number
): void {
  const now = Date.now();
  matchupStore.set(matchupId, {
    winner,
    videoA_score,
    videoB_score,
    created_at: now,
    start_time: now
  });
  
  // Clean up old entries
  for (const [id, data] of matchupStore.entries()) {
    if (now - data.created_at > MATCHUP_TTL) {
      matchupStore.delete(id);
    }
  }
}

export function getMatchup(matchupId: string): MatchupData | null {
  const matchup = matchupStore.get(matchupId);
  if (!matchup) return null;
  
  // Check if matchup is expired
  if (Date.now() - matchup.created_at > MATCHUP_TTL) {
    matchupStore.delete(matchupId);
    return null;
  }
  
  return matchup;
}

export function getMatchupCount(): number {
  return matchupStore.size;
}
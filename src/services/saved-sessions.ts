import type { SessionResult } from '@/services/analysis';

export type SavedSession = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  score: number;
  savedAt: number;
};

/**
 * MOCK in-memory store — demo only.
 *
 * Not persisted and resets on app restart. Replace with real storage or a
 * backend once that work begins.
 */
const savedSessions: SavedSession[] = [];

export function saveSession(result: SessionResult): SavedSession {
  const session: SavedSession = {
    id: `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    exerciseId: result.exerciseId,
    exerciseName: result.exerciseName,
    score: result.score,
    savedAt: Date.now(),
  };
  savedSessions.unshift(session);
  return session;
}

export function countSavedSessions(): number {
  return savedSessions.length;
}
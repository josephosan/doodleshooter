export const COLORS = ['blue', 'red', 'orange', 'green', 'pink', 'black'] as const;
export type PlayerColor = typeof COLORS[number];
export type MatchMode = 'ffa' | 'teams';
export type MatchResult = 'win' | 'loss' | 'draw';

export type AuthUser = {
  id: string;
  username: string;
  color: PlayerColor;
};

export function badgeFor(kills: number): { level: number; label: string } | null {
  const level = Math.floor(Math.max(0, kills) / 100) * 100;
  return level >= 100 ? { level, label: `${level} KILLS` } : null;
}

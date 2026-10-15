export const COLORS = ['blue', 'red', 'orange', 'green', 'pink', 'black'] as const;
export type PlayerColor = typeof COLORS[number];
export type MatchMode = 'ffa' | 'teams';
export type MatchResult = 'win' | 'loss' | 'draw';

export type AuthUser = {
  id: string;
  username: string;
  color: PlayerColor;
};

export const BADGE_TIERS = [
  { level: 100, label: 'dolche' },
  { level: 500, label: 'dolack' },
  { level: 1000, label: 'sardolche' },
  { level: 2500, label: 'sardol' },
  { level: 3700, label: 'dolbor' },
  { level: 7000, label: 'superdol' },
  { level: 10000, label: 'superdolplus' },
  { level: 20000, label: 'ultradolgod' },
] as const;

export function badgeFor(kills: number): { level: number; label: string } | null {
  const total = Math.max(0, Number(kills) || 0);
  for (let i = BADGE_TIERS.length - 1; i >= 0; i--) {
    const badge = BADGE_TIERS[i]!;
    if (total >= badge.level) return { level: badge.level, label: badge.label };
  }
  return null;
}

import { COLORS, type MatchMode, type MatchResult, type PlayerColor } from './types.js';

const USERNAME = /^[A-Za-z0-9_]{3,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAP_KEY = /^[a-z0-9_-]{1,32}$/;

export function username(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim(); return USERNAME.test(clean) ? clean : null;
}
export function password(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128 ? value : null;
}
export function color(value: unknown): PlayerColor | null {
  return typeof value === 'string' && (COLORS as readonly string[]).includes(value) ? value as PlayerColor : null;
}
export function uuid(value: unknown): string | null { return typeof value === 'string' && UUID.test(value) ? value : null; }
export function mapKey(value: unknown): string | null { return typeof value === 'string' && MAP_KEY.test(value) ? value : null; }
export function mode(value: unknown): MatchMode | null { return value === 'ffa' || value === 'teams' ? value : null; }
export function result(value: unknown): MatchResult | null { return value === 'win' || value === 'loss' || value === 'draw' ? value : null; }
export function integer(value: unknown, min: number, max: number): number | null {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : null;
}

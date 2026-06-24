import { PlayerRatings } from '@/models/player';

export type RatingCategory = 'offensive' | 'defensive' | 'physical';

export interface RatingDefinition {
  key: keyof PlayerRatings;
  label: string;
  category: RatingCategory;
  description: string;
}

export const RATING_DEFINITIONS: RatingDefinition[] = [
  { key: 'outsideShooting', label: 'Outside Shooting', category: 'offensive', description: 'Three-point shooting ability and range' },
  { key: 'midrangeShooting', label: 'Mid-Range', category: 'offensive', description: 'Mid-range jumper accuracy and footwork' },
  { key: 'interiorScoring', label: 'Interior Scoring', category: 'offensive', description: 'Finishing at the rim, post moves, layups' },
  { key: 'freeThrowShooting', label: 'Free Throws', category: 'offensive', description: 'Free throw accuracy' },
  { key: 'ballHandling', label: 'Ball Handling', category: 'offensive', description: 'Dribbling, handle under pressure' },
  { key: 'passing', label: 'Passing', category: 'offensive', description: 'Court vision, pass accuracy, creativity' },
  { key: 'offensiveIQ', label: 'Offensive IQ', category: 'offensive', description: 'Shot selection, spacing, cutting instincts' },
  { key: 'perimeterDefense', label: 'Perimeter Defense', category: 'defensive', description: 'On-ball defense, lateral quickness' },
  { key: 'interiorDefense', label: 'Interior Defense', category: 'defensive', description: 'Rim protection, post defense' },
  { key: 'defensiveIQ', label: 'Defensive IQ', category: 'defensive', description: 'Help defense, rotations, positioning' },
  { key: 'steal', label: 'Steal', category: 'defensive', description: 'Ball-hawking, passing lane reads' },
  { key: 'block', label: 'Block', category: 'defensive', description: 'Shot-blocking ability and timing' },
  { key: 'athleticism', label: 'Athleticism', category: 'physical', description: 'Speed, vertical, explosiveness' },
  { key: 'strength', label: 'Strength', category: 'physical', description: 'Body contact, screening ability' },
  { key: 'rebounding', label: 'Rebounding', category: 'physical', description: 'Positioning, boxing out, timing' },
  { key: 'stamina', label: 'Stamina', category: 'physical', description: 'Fatigue resistance, minutes capacity' },
  { key: 'durability', label: 'Durability', category: 'physical', description: 'Injury resistance' },
];

export function getRatingLabel(value: number): string {
  if (value >= 70) return 'Elite';
  if (value >= 60) return 'All-Star';
  if (value >= 50) return 'Above Average';
  if (value >= 40) return 'Average';
  if (value >= 30) return 'Below Average';
  if (value >= 20) return 'Poor';
  return 'Replacement';
}

export function getRatingColor(value: number): string {
  if (value >= 70) return '#22c55e'; // green
  if (value >= 60) return '#3b82f6'; // blue
  if (value >= 50) return '#8b5cf6'; // purple
  if (value >= 40) return '#f59e0b'; // amber
  if (value >= 30) return '#f97316'; // orange
  return '#ef4444'; // red
}

export function calculateOverall(ratings: PlayerRatings): number {
  const values = Object.values(ratings) as number[];
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

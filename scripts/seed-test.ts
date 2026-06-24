import { Player, Position, PlayerRatings, PlayerTendencies, PerGameStats } from '../src/models/player';
import { Team, NBA_TEAMS } from '../src/models/team';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

// Real NBA rosters (2024-25 season key players) with approximate ratings
const TEAM_ROSTERS: Record<string, Array<{
  first: string; last: string; pos: Position; num: number;
  age: number; ht: number; wt: number; exp: number;
  ovr: number; // approximate overall to scale ratings from
  archetype: 'shooter' | 'slasher' | 'playmaker' | 'big' | 'wing' | 'stretch_big' | 'two_way' | 'rim_protector';
  ppg: number; rpg: number; apg: number; spg: number; bpg: number;
  fgPct: number; threePct: number; ftPct: number; tpa: number;
}>> = {
  BOS: [
    { first: 'Jayson', last: 'Tatum', pos: 'SF', num: 0, age: 26, ht: 80, wt: 210, exp: 7, ovr: 72, archetype: 'wing', ppg: 26.9, rpg: 8.1, apg: 4.9, spg: 1.0, bpg: 0.6, fgPct: 0.471, threePct: 0.375, ftPct: 0.835, tpa: 7.2 },
    { first: 'Jaylen', last: 'Brown', pos: 'SG', num: 7, age: 27, ht: 78, wt: 223, exp: 8, ovr: 68, archetype: 'two_way', ppg: 23.0, rpg: 5.5, apg: 3.6, spg: 1.2, bpg: 0.5, fgPct: 0.494, threePct: 0.354, ftPct: 0.706, tpa: 5.1 },
    { first: 'Derrick', last: 'White', pos: 'SG', num: 9, age: 30, ht: 76, wt: 190, exp: 7, ovr: 64, archetype: 'two_way', ppg: 15.2, rpg: 4.2, apg: 5.2, spg: 1.0, bpg: 0.9, fgPct: 0.460, threePct: 0.399, ftPct: 0.895, tpa: 5.8 },
    { first: 'Jrue', last: 'Holiday', pos: 'PG', num: 4, age: 34, ht: 76, wt: 205, exp: 15, ovr: 62, archetype: 'two_way', ppg: 12.0, rpg: 5.4, apg: 4.5, spg: 0.9, bpg: 0.4, fgPct: 0.440, threePct: 0.365, ftPct: 0.862, tpa: 3.5 },
    { first: 'Kristaps', last: 'Porzingis', pos: 'C', num: 8, age: 29, ht: 87, wt: 240, exp: 9, ovr: 66, archetype: 'stretch_big', ppg: 20.3, rpg: 7.2, apg: 2.0, spg: 0.7, bpg: 1.9, fgPct: 0.515, threePct: 0.371, ftPct: 0.858, tpa: 4.5 },
    { first: 'Al', last: 'Horford', pos: 'PF', num: 42, age: 38, ht: 82, wt: 240, exp: 17, ovr: 50, archetype: 'stretch_big', ppg: 8.6, rpg: 6.2, apg: 2.6, spg: 0.5, bpg: 0.9, fgPct: 0.472, threePct: 0.382, ftPct: 0.700, tpa: 2.8 },
    { first: 'Payton', last: 'Pritchard', pos: 'PG', num: 11, age: 26, ht: 73, wt: 195, exp: 4, ovr: 52, archetype: 'shooter', ppg: 14.0, rpg: 2.4, apg: 3.0, spg: 0.8, bpg: 0.2, fgPct: 0.453, threePct: 0.417, ftPct: 0.872, tpa: 6.5 },
    { first: 'Sam', last: 'Hauser', pos: 'SF', num: 30, age: 26, ht: 79, wt: 217, exp: 3, ovr: 44, archetype: 'shooter', ppg: 7.2, rpg: 3.0, apg: 1.0, spg: 0.4, bpg: 0.2, fgPct: 0.430, threePct: 0.406, ftPct: 0.800, tpa: 4.5 },
    { first: 'Luke', last: 'Kornet', pos: 'C', num: 40, age: 28, ht: 87, wt: 250, exp: 5, ovr: 38, archetype: 'rim_protector', ppg: 5.5, rpg: 4.0, apg: 1.0, spg: 0.3, bpg: 1.5, fgPct: 0.540, threePct: 0.320, ftPct: 0.700, tpa: 1.0 },
    { first: 'Neemias', last: 'Queta', pos: 'C', num: 88, age: 24, ht: 84, wt: 245, exp: 3, ovr: 36, archetype: 'big', ppg: 3.0, rpg: 3.5, apg: 0.5, spg: 0.3, bpg: 0.8, fgPct: 0.560, threePct: 0.000, ftPct: 0.600, tpa: 0.0 },
    { first: 'Jordan', last: 'Walsh', pos: 'SF', num: 27, age: 20, ht: 79, wt: 205, exp: 1, ovr: 30, archetype: 'wing', ppg: 2.5, rpg: 1.5, apg: 0.5, spg: 0.3, bpg: 0.2, fgPct: 0.380, threePct: 0.280, ftPct: 0.650, tpa: 1.5 },
    { first: 'Jaden', last: 'Springer', pos: 'SG', num: 12, age: 22, ht: 76, wt: 204, exp: 3, ovr: 34, archetype: 'two_way', ppg: 3.5, rpg: 1.5, apg: 1.0, spg: 0.5, bpg: 0.2, fgPct: 0.400, threePct: 0.300, ftPct: 0.700, tpa: 1.2 },
  ],
  LAL: [
    { first: 'LeBron', last: 'James', pos: 'SF', num: 23, age: 39, ht: 81, wt: 250, exp: 21, ovr: 70, archetype: 'playmaker', ppg: 23.7, rpg: 7.3, apg: 9.0, spg: 1.3, bpg: 0.5, fgPct: 0.540, threePct: 0.410, ftPct: 0.750, tpa: 4.1 },
    { first: 'Anthony', last: 'Davis', pos: 'PF', num: 3, age: 31, ht: 82, wt: 253, exp: 12, ovr: 72, archetype: 'big', ppg: 25.1, rpg: 12.6, apg: 3.5, spg: 1.2, bpg: 2.3, fgPct: 0.536, threePct: 0.280, ftPct: 0.813, tpa: 1.8 },
    { first: 'Austin', last: 'Reaves', pos: 'SG', num: 15, age: 26, ht: 77, wt: 197, exp: 3, ovr: 60, archetype: 'playmaker', ppg: 18.0, rpg: 4.5, apg: 6.5, spg: 1.0, bpg: 0.3, fgPct: 0.478, threePct: 0.365, ftPct: 0.855, tpa: 5.0 },
    { first: 'Dalton', last: 'Knecht', pos: 'SG', num: 4, age: 23, ht: 78, wt: 213, exp: 1, ovr: 50, archetype: 'shooter', ppg: 12.0, rpg: 3.0, apg: 1.5, spg: 0.5, bpg: 0.2, fgPct: 0.445, threePct: 0.380, ftPct: 0.820, tpa: 5.5 },
    { first: "D'Angelo", last: 'Russell', pos: 'PG', num: 1, age: 28, ht: 76, wt: 193, exp: 9, ovr: 52, archetype: 'playmaker', ppg: 12.4, rpg: 2.8, apg: 5.0, spg: 0.8, bpg: 0.2, fgPct: 0.420, threePct: 0.360, ftPct: 0.780, tpa: 5.8 },
    { first: 'Rui', last: 'Hachimura', pos: 'PF', num: 28, age: 26, ht: 80, wt: 230, exp: 5, ovr: 50, archetype: 'wing', ppg: 11.5, rpg: 4.5, apg: 1.2, spg: 0.4, bpg: 0.3, fgPct: 0.480, threePct: 0.340, ftPct: 0.780, tpa: 2.5 },
    { first: 'Jarred', last: 'Vanderbilt', pos: 'PF', num: 2, age: 25, ht: 81, wt: 214, exp: 5, ovr: 46, archetype: 'two_way', ppg: 5.0, rpg: 5.5, apg: 1.5, spg: 1.0, bpg: 0.5, fgPct: 0.480, threePct: 0.280, ftPct: 0.600, tpa: 0.8 },
    { first: 'Gabe', last: 'Vincent', pos: 'PG', num: 7, age: 28, ht: 75, wt: 195, exp: 4, ovr: 42, archetype: 'shooter', ppg: 6.5, rpg: 1.8, apg: 2.5, spg: 0.5, bpg: 0.1, fgPct: 0.400, threePct: 0.350, ftPct: 0.850, tpa: 3.5 },
    { first: 'Jaxson', last: 'Hayes', pos: 'C', num: 10, age: 24, ht: 83, wt: 220, exp: 5, ovr: 40, archetype: 'rim_protector', ppg: 5.5, rpg: 3.5, apg: 0.5, spg: 0.3, bpg: 1.0, fgPct: 0.600, threePct: 0.200, ftPct: 0.600, tpa: 0.3 },
    { first: 'Christian', last: 'Wood', pos: 'C', num: 35, age: 28, ht: 82, wt: 214, exp: 6, ovr: 42, archetype: 'stretch_big', ppg: 7.0, rpg: 4.5, apg: 0.8, spg: 0.3, bpg: 0.6, fgPct: 0.470, threePct: 0.340, ftPct: 0.750, tpa: 2.8 },
    { first: 'Max', last: 'Christie', pos: 'SG', num: 12, age: 21, ht: 78, wt: 190, exp: 2, ovr: 36, archetype: 'two_way', ppg: 4.0, rpg: 2.0, apg: 1.0, spg: 0.5, bpg: 0.2, fgPct: 0.410, threePct: 0.350, ftPct: 0.750, tpa: 2.0 },
    { first: 'Cam', last: 'Reddish', pos: 'SF', num: 5, age: 25, ht: 80, wt: 218, exp: 5, ovr: 38, archetype: 'wing', ppg: 4.5, rpg: 2.0, apg: 0.8, spg: 0.4, bpg: 0.3, fgPct: 0.390, threePct: 0.310, ftPct: 0.700, tpa: 2.2 },
  ],
  GSW: [
    { first: 'Stephen', last: 'Curry', pos: 'PG', num: 30, age: 36, ht: 74, wt: 185, exp: 15, ovr: 72, archetype: 'shooter', ppg: 22.5, rpg: 5.1, apg: 6.4, spg: 0.7, bpg: 0.2, fgPct: 0.450, threePct: 0.408, ftPct: 0.923, tpa: 11.3 },
    { first: 'Andrew', last: 'Wiggins', pos: 'SF', num: 22, age: 29, ht: 79, wt: 197, exp: 10, ovr: 56, archetype: 'wing', ppg: 15.0, rpg: 4.5, apg: 2.0, spg: 0.8, bpg: 0.5, fgPct: 0.455, threePct: 0.340, ftPct: 0.700, tpa: 3.8 },
    { first: 'Draymond', last: 'Green', pos: 'PF', num: 23, age: 34, ht: 78, wt: 230, exp: 12, ovr: 56, archetype: 'playmaker', ppg: 8.5, rpg: 5.5, apg: 6.0, spg: 1.0, bpg: 0.8, fgPct: 0.445, threePct: 0.320, ftPct: 0.700, tpa: 2.0 },
    { first: 'Jonathan', last: 'Kuminga', pos: 'PF', num: 0, age: 22, ht: 79, wt: 225, exp: 3, ovr: 52, archetype: 'slasher', ppg: 13.0, rpg: 4.5, apg: 2.0, spg: 0.6, bpg: 0.4, fgPct: 0.520, threePct: 0.320, ftPct: 0.680, tpa: 1.8 },
    { first: 'Kevon', last: 'Looney', pos: 'C', num: 5, age: 28, ht: 81, wt: 222, exp: 9, ovr: 46, archetype: 'big', ppg: 5.5, rpg: 7.0, apg: 2.5, spg: 0.4, bpg: 0.4, fgPct: 0.560, threePct: 0.000, ftPct: 0.600, tpa: 0.0 },
    { first: 'Brandin', last: 'Podziemski', pos: 'SG', num: 2, age: 21, ht: 77, wt: 205, exp: 1, ovr: 46, archetype: 'playmaker', ppg: 9.0, rpg: 4.5, apg: 3.8, spg: 0.7, bpg: 0.2, fgPct: 0.420, threePct: 0.340, ftPct: 0.750, tpa: 3.5 },
    { first: 'Moses', last: 'Moody', pos: 'SG', num: 4, age: 22, ht: 78, wt: 211, exp: 3, ovr: 42, archetype: 'two_way', ppg: 7.0, rpg: 2.5, apg: 1.5, spg: 0.5, bpg: 0.3, fgPct: 0.430, threePct: 0.350, ftPct: 0.780, tpa: 3.0 },
    { first: 'Gary', last: 'Payton II', pos: 'SG', num: 8, age: 31, ht: 75, wt: 195, exp: 6, ovr: 44, archetype: 'two_way', ppg: 5.5, rpg: 2.8, apg: 1.5, spg: 1.2, bpg: 0.3, fgPct: 0.490, threePct: 0.330, ftPct: 0.600, tpa: 1.5 },
    { first: 'Trayce', last: 'Jackson-Davis', pos: 'C', num: 32, age: 24, ht: 81, wt: 245, exp: 1, ovr: 42, archetype: 'big', ppg: 7.0, rpg: 5.0, apg: 2.0, spg: 0.5, bpg: 1.2, fgPct: 0.620, threePct: 0.000, ftPct: 0.600, tpa: 0.0 },
    { first: 'Buddy', last: 'Hield', pos: 'SG', num: 24, age: 31, ht: 76, wt: 220, exp: 8, ovr: 48, archetype: 'shooter', ppg: 11.0, rpg: 3.0, apg: 2.0, spg: 0.5, bpg: 0.2, fgPct: 0.430, threePct: 0.390, ftPct: 0.870, tpa: 7.0 },
    { first: 'Gui', last: 'Santos', pos: 'SF', num: 15, age: 22, ht: 80, wt: 205, exp: 1, ovr: 32, archetype: 'wing', ppg: 3.0, rpg: 1.8, apg: 0.5, spg: 0.3, bpg: 0.2, fgPct: 0.400, threePct: 0.300, ftPct: 0.700, tpa: 1.5 },
    { first: 'Pat', last: 'Spencer', pos: 'PG', num: 61, age: 27, ht: 75, wt: 205, exp: 1, ovr: 30, archetype: 'playmaker', ppg: 2.5, rpg: 1.2, apg: 2.0, spg: 0.4, bpg: 0.1, fgPct: 0.400, threePct: 0.280, ftPct: 0.700, tpa: 1.0 },
  ],
  DEN: [
    { first: 'Nikola', last: 'Jokic', pos: 'C', num: 15, age: 29, ht: 83, wt: 284, exp: 9, ovr: 78, archetype: 'playmaker', ppg: 26.4, rpg: 12.4, apg: 9.0, spg: 1.4, bpg: 0.9, fgPct: 0.580, threePct: 0.355, ftPct: 0.817, tpa: 3.0 },
    { first: 'Jamal', last: 'Murray', pos: 'PG', num: 27, age: 27, ht: 76, wt: 215, exp: 8, ovr: 62, archetype: 'shooter', ppg: 18.5, rpg: 4.0, apg: 6.5, spg: 1.0, bpg: 0.3, fgPct: 0.445, threePct: 0.360, ftPct: 0.860, tpa: 5.5 },
    { first: 'Michael', last: 'Porter Jr.', pos: 'SF', num: 1, age: 26, ht: 82, wt: 218, exp: 5, ovr: 58, archetype: 'shooter', ppg: 15.5, rpg: 7.0, apg: 1.5, spg: 0.5, bpg: 0.5, fgPct: 0.490, threePct: 0.395, ftPct: 0.820, tpa: 4.5 },
    { first: 'Aaron', last: 'Gordon', pos: 'PF', num: 50, age: 29, ht: 80, wt: 235, exp: 10, ovr: 56, archetype: 'two_way', ppg: 13.5, rpg: 6.5, apg: 3.0, spg: 0.7, bpg: 0.6, fgPct: 0.540, threePct: 0.320, ftPct: 0.730, tpa: 2.0 },
    { first: 'Kentavious', last: 'Caldwell-Pope', pos: 'SG', num: 5, age: 31, ht: 77, wt: 204, exp: 11, ovr: 52, archetype: 'two_way', ppg: 10.0, rpg: 2.3, apg: 2.0, spg: 1.2, bpg: 0.3, fgPct: 0.440, threePct: 0.380, ftPct: 0.820, tpa: 4.0 },
    { first: 'Christian', last: 'Braun', pos: 'SG', num: 0, age: 23, ht: 78, wt: 218, exp: 2, ovr: 48, archetype: 'two_way', ppg: 9.0, rpg: 3.5, apg: 2.0, spg: 0.8, bpg: 0.3, fgPct: 0.480, threePct: 0.350, ftPct: 0.790, tpa: 2.5 },
    { first: 'Reggie', last: 'Jackson', pos: 'PG', num: 7, age: 34, ht: 75, wt: 208, exp: 13, ovr: 40, archetype: 'playmaker', ppg: 6.0, rpg: 2.0, apg: 3.0, spg: 0.5, bpg: 0.1, fgPct: 0.390, threePct: 0.310, ftPct: 0.780, tpa: 2.5 },
    { first: 'DeAndre', last: 'Jordan', pos: 'C', num: 6, age: 35, ht: 83, wt: 265, exp: 16, ovr: 34, archetype: 'rim_protector', ppg: 3.0, rpg: 5.0, apg: 0.5, spg: 0.2, bpg: 0.7, fgPct: 0.650, threePct: 0.000, ftPct: 0.450, tpa: 0.0 },
    { first: 'Peyton', last: 'Watson', pos: 'SF', num: 8, age: 21, ht: 80, wt: 203, exp: 2, ovr: 38, archetype: 'two_way', ppg: 4.0, rpg: 2.5, apg: 0.8, spg: 0.6, bpg: 0.5, fgPct: 0.420, threePct: 0.300, ftPct: 0.680, tpa: 1.5 },
    { first: 'Zeke', last: 'Nnaji', pos: 'PF', num: 22, age: 23, ht: 83, wt: 240, exp: 4, ovr: 36, archetype: 'big', ppg: 4.5, rpg: 3.0, apg: 0.5, spg: 0.2, bpg: 0.3, fgPct: 0.500, threePct: 0.320, ftPct: 0.720, tpa: 1.0 },
    { first: 'Julian', last: 'Strawther', pos: 'SG', num: 4, age: 22, ht: 77, wt: 205, exp: 1, ovr: 34, archetype: 'shooter', ppg: 4.5, rpg: 2.0, apg: 0.8, spg: 0.3, bpg: 0.1, fgPct: 0.400, threePct: 0.340, ftPct: 0.750, tpa: 2.5 },
    { first: 'Hunter', last: 'Tyson', pos: 'PF', num: 44, age: 24, ht: 80, wt: 215, exp: 1, ovr: 32, archetype: 'wing', ppg: 3.0, rpg: 2.5, apg: 0.5, spg: 0.3, bpg: 0.3, fgPct: 0.420, threePct: 0.330, ftPct: 0.700, tpa: 1.5 },
  ],
  MIL: [
    { first: 'Giannis', last: 'Antetokounmpo', pos: 'PF', num: 34, age: 29, ht: 83, wt: 243, exp: 11, ovr: 76, archetype: 'slasher', ppg: 31.1, rpg: 11.6, apg: 5.8, spg: 1.2, bpg: 1.5, fgPct: 0.614, threePct: 0.274, ftPct: 0.657, tpa: 1.4 },
    { first: 'Damian', last: 'Lillard', pos: 'PG', num: 0, age: 33, ht: 74, wt: 195, exp: 12, ovr: 66, archetype: 'shooter', ppg: 24.3, rpg: 4.4, apg: 7.0, spg: 0.9, bpg: 0.3, fgPct: 0.437, threePct: 0.358, ftPct: 0.920, tpa: 8.5 },
    { first: 'Khris', last: 'Middleton', pos: 'SF', num: 22, age: 33, ht: 79, wt: 222, exp: 12, ovr: 54, archetype: 'shooter', ppg: 12.5, rpg: 4.5, apg: 4.0, spg: 0.5, bpg: 0.2, fgPct: 0.430, threePct: 0.350, ftPct: 0.870, tpa: 4.0 },
    { first: 'Brook', last: 'Lopez', pos: 'C', num: 11, age: 36, ht: 84, wt: 282, exp: 16, ovr: 56, archetype: 'stretch_big', ppg: 12.5, rpg: 5.0, apg: 1.5, spg: 0.3, bpg: 2.4, fgPct: 0.480, threePct: 0.360, ftPct: 0.750, tpa: 4.5 },
    { first: 'Bobby', last: 'Portis', pos: 'PF', num: 9, age: 29, ht: 82, wt: 250, exp: 9, ovr: 50, archetype: 'big', ppg: 12.0, rpg: 7.5, apg: 1.5, spg: 0.5, bpg: 0.3, fgPct: 0.490, threePct: 0.340, ftPct: 0.750, tpa: 3.0 },
    { first: 'Pat', last: 'Connaughton', pos: 'SG', num: 24, age: 31, ht: 77, wt: 209, exp: 8, ovr: 40, archetype: 'shooter', ppg: 5.0, rpg: 2.5, apg: 1.0, spg: 0.4, bpg: 0.3, fgPct: 0.410, threePct: 0.360, ftPct: 0.800, tpa: 3.0 },
    { first: 'Malik', last: 'Beasley', pos: 'SG', num: 5, age: 28, ht: 76, wt: 187, exp: 8, ovr: 46, archetype: 'shooter', ppg: 11.0, rpg: 2.5, apg: 1.5, spg: 0.5, bpg: 0.2, fgPct: 0.420, threePct: 0.380, ftPct: 0.820, tpa: 6.5 },
    { first: 'MarJon', last: 'Beauchamp', pos: 'SF', num: 3, age: 23, ht: 78, wt: 199, exp: 2, ovr: 36, archetype: 'slasher', ppg: 4.5, rpg: 2.5, apg: 1.0, spg: 0.5, bpg: 0.3, fgPct: 0.420, threePct: 0.290, ftPct: 0.650, tpa: 1.5 },
    { first: 'AJ', last: 'Green', pos: 'SG', num: 20, age: 24, ht: 76, wt: 205, exp: 2, ovr: 38, archetype: 'shooter', ppg: 5.5, rpg: 1.5, apg: 1.0, spg: 0.3, bpg: 0.1, fgPct: 0.410, threePct: 0.370, ftPct: 0.800, tpa: 4.0 },
    { first: 'Andre', last: 'Jackson Jr.', pos: 'SF', num: 44, age: 23, ht: 78, wt: 209, exp: 1, ovr: 34, archetype: 'two_way', ppg: 3.0, rpg: 2.0, apg: 1.5, spg: 0.6, bpg: 0.3, fgPct: 0.400, threePct: 0.280, ftPct: 0.650, tpa: 1.0 },
    { first: 'Chris', last: 'Livingston', pos: 'SF', num: 8, age: 21, ht: 78, wt: 220, exp: 1, ovr: 32, archetype: 'slasher', ppg: 3.5, rpg: 2.0, apg: 0.5, spg: 0.3, bpg: 0.2, fgPct: 0.430, threePct: 0.260, ftPct: 0.650, tpa: 1.0 },
    { first: 'Thanasis', last: 'Antetokounmpo', pos: 'PF', num: 43, age: 31, ht: 79, wt: 219, exp: 4, ovr: 26, archetype: 'two_way', ppg: 1.5, rpg: 1.0, apg: 0.3, spg: 0.2, bpg: 0.1, fgPct: 0.380, threePct: 0.200, ftPct: 0.500, tpa: 0.3 },
  ],
  OKC: [
    { first: 'Shai', last: 'Gilgeous-Alexander', pos: 'PG', num: 2, age: 25, ht: 78, wt: 195, exp: 6, ovr: 76, archetype: 'slasher', ppg: 30.1, rpg: 5.5, apg: 6.2, spg: 2.0, bpg: 0.7, fgPct: 0.535, threePct: 0.353, ftPct: 0.874, tpa: 4.5 },
    { first: 'Chet', last: 'Holmgren', pos: 'C', num: 7, age: 22, ht: 85, wt: 208, exp: 1, ovr: 62, archetype: 'rim_protector', ppg: 16.5, rpg: 7.8, apg: 2.5, spg: 0.8, bpg: 2.6, fgPct: 0.530, threePct: 0.370, ftPct: 0.800, tpa: 3.5 },
    { first: 'Jalen', last: 'Williams', pos: 'SF', num: 8, age: 23, ht: 78, wt: 193, exp: 2, ovr: 64, archetype: 'two_way', ppg: 19.1, rpg: 5.8, apg: 5.0, spg: 1.3, bpg: 0.7, fgPct: 0.485, threePct: 0.350, ftPct: 0.800, tpa: 3.5 },
    { first: 'Luguentz', last: 'Dort', pos: 'SG', num: 5, age: 25, ht: 76, wt: 220, exp: 5, ovr: 52, archetype: 'two_way', ppg: 10.5, rpg: 3.5, apg: 2.0, spg: 1.0, bpg: 0.3, fgPct: 0.430, threePct: 0.340, ftPct: 0.780, tpa: 4.0 },
    { first: 'Isaiah', last: 'Hartenstein', pos: 'C', num: 55, age: 26, ht: 84, wt: 250, exp: 5, ovr: 54, archetype: 'big', ppg: 10.0, rpg: 8.5, apg: 2.8, spg: 0.6, bpg: 1.0, fgPct: 0.550, threePct: 0.200, ftPct: 0.720, tpa: 0.5 },
    { first: 'Alex', last: 'Caruso', pos: 'SG', num: 6, age: 30, ht: 77, wt: 186, exp: 7, ovr: 52, archetype: 'two_way', ppg: 7.5, rpg: 3.5, apg: 3.5, spg: 1.5, bpg: 0.5, fgPct: 0.420, threePct: 0.340, ftPct: 0.750, tpa: 2.5 },
    { first: 'Isaiah', last: 'Joe', pos: 'SG', num: 11, age: 25, ht: 76, wt: 180, exp: 4, ovr: 44, archetype: 'shooter', ppg: 7.5, rpg: 2.0, apg: 1.5, spg: 0.5, bpg: 0.2, fgPct: 0.420, threePct: 0.390, ftPct: 0.850, tpa: 5.0 },
    { first: 'Kenrich', last: 'Williams', pos: 'PF', num: 34, age: 29, ht: 79, wt: 210, exp: 6, ovr: 42, archetype: 'two_way', ppg: 5.0, rpg: 3.5, apg: 1.5, spg: 0.5, bpg: 0.3, fgPct: 0.450, threePct: 0.320, ftPct: 0.700, tpa: 1.5 },
    { first: 'Aaron', last: 'Wiggins', pos: 'SG', num: 21, age: 25, ht: 78, wt: 200, exp: 3, ovr: 42, archetype: 'wing', ppg: 6.0, rpg: 2.5, apg: 1.5, spg: 0.5, bpg: 0.3, fgPct: 0.440, threePct: 0.340, ftPct: 0.780, tpa: 2.5 },
    { first: 'Cason', last: 'Wallace', pos: 'PG', num: 22, age: 20, ht: 76, wt: 193, exp: 1, ovr: 40, archetype: 'two_way', ppg: 5.5, rpg: 2.5, apg: 2.5, spg: 0.8, bpg: 0.3, fgPct: 0.400, threePct: 0.310, ftPct: 0.720, tpa: 2.0 },
    { first: 'Jaylin', last: 'Williams', pos: 'PF', num: 6, age: 22, ht: 82, wt: 240, exp: 2, ovr: 38, archetype: 'big', ppg: 4.0, rpg: 4.0, apg: 1.0, spg: 0.4, bpg: 0.4, fgPct: 0.460, threePct: 0.300, ftPct: 0.650, tpa: 1.0 },
    { first: 'Ousmane', last: 'Dieng', pos: 'SF', num: 13, age: 21, ht: 82, wt: 215, exp: 2, ovr: 34, archetype: 'wing', ppg: 3.0, rpg: 2.0, apg: 0.8, spg: 0.3, bpg: 0.3, fgPct: 0.390, threePct: 0.290, ftPct: 0.680, tpa: 1.5 },
  ],
};

function generatePlayerFromArchetype(
  data: typeof TEAM_ROSTERS['BOS'][0],
  teamId: string,
  playerId: string,
): Player {
  const ratings = generateRatings(data);
  const tendencies = generateTendencies(data);
  const potential = generatePotential(ratings, data.age);
  const stats = generateCareerStats(data);

  return {
    id: playerId,
    firstName: data.first,
    lastName: data.last,
    position: data.pos,
    height: data.ht,
    weight: data.wt,
    age: data.age,
    experience: data.exp,
    teamId,
    jerseyNumber: data.num,
    ratings,
    potential,
    scoutingAccuracy: 0.5 + Math.random() * 0.3,
    tendencies,
    contract: {
      yearsRemaining: Math.max(1, Math.floor(Math.random() * 4) + 1),
      salaryPerYear: estimateSalary(data.ovr),
    },
    health: { healthy: true },
    careerStats: stats,
  };
}

function generateRatings(data: typeof TEAM_ROSTERS['BOS'][0]): PlayerRatings {
  const base = data.ovr;
  const a = data.archetype;

  const scale = (offset: number) => Math.max(1, Math.min(80, base + offset + Math.floor(Math.random() * 6) - 3));

  const archetypeMods: Record<string, Partial<Record<keyof PlayerRatings, number>>> = {
    shooter: { outsideShooting: 12, midrangeShooting: 8, interiorScoring: -6, freeThrowShooting: 10, ballHandling: 0, passing: -2 },
    slasher: { outsideShooting: -4, midrangeShooting: 0, interiorScoring: 10, freeThrowShooting: -2, ballHandling: 4, athleticism: 8 },
    playmaker: { outsideShooting: 2, passing: 12, ballHandling: 8, offensiveIQ: 8, interiorScoring: -2, rebounding: -4 },
    big: { interiorScoring: 6, interiorDefense: 8, rebounding: 10, block: 6, strength: 10, outsideShooting: -12, ballHandling: -12 },
    wing: { outsideShooting: 2, midrangeShooting: 2, interiorScoring: 2, perimeterDefense: 2, athleticism: 4 },
    stretch_big: { outsideShooting: 4, interiorDefense: 4, rebounding: 6, block: 4, strength: 6, ballHandling: -10 },
    two_way: { perimeterDefense: 8, defensiveIQ: 8, steal: 6, interiorDefense: 2, outsideShooting: -2 },
    rim_protector: { block: 14, interiorDefense: 12, rebounding: 6, strength: 6, outsideShooting: -14, ballHandling: -14 },
  };

  const mods = archetypeMods[a] ?? {};

  return {
    outsideShooting: scale(mods.outsideShooting ?? 0),
    midrangeShooting: scale(mods.midrangeShooting ?? 0),
    interiorScoring: scale(mods.interiorScoring ?? 0),
    freeThrowShooting: scale(mods.freeThrowShooting ?? 0),
    ballHandling: scale(mods.ballHandling ?? 0),
    passing: scale(mods.passing ?? 0),
    offensiveIQ: scale(mods.offensiveIQ ?? 0),
    perimeterDefense: scale(mods.perimeterDefense ?? 0),
    interiorDefense: scale(mods.interiorDefense ?? 0),
    defensiveIQ: scale(mods.defensiveIQ ?? 0),
    steal: scale(mods.steal ?? 0),
    block: scale(mods.block ?? 0),
    athleticism: scale(mods.athleticism ?? 0),
    strength: scale(mods.strength ?? 0),
    rebounding: scale(mods.rebounding ?? 0),
    stamina: scale(Math.min(8, data.ppg / 3)),
    durability: scale(0),
  };
}

function generatePotential(current: PlayerRatings, age: number): PlayerRatings {
  const pot = { ...current };
  let mult = 1.0;
  if (age <= 22) mult = 1.20;
  else if (age <= 25) mult = 1.10;
  else if (age <= 28) mult = 1.03;
  else if (age <= 32) mult = 0.98;
  else mult = 0.93;

  for (const key of Object.keys(pot) as (keyof PlayerRatings)[]) {
    pot[key] = Math.max(1, Math.min(80, Math.round(pot[key] * mult)));
  }
  return pot;
}

function generateTendencies(data: typeof TEAM_ROSTERS['BOS'][0]): PlayerTendencies {
  const tpa = data.tpa;
  const fga = data.ppg / 2; // rough estimate
  const threePtRate = Math.min(0.60, tpa / Math.max(1, fga));

  return {
    isolationFreq: data.archetype === 'slasher' ? 0.15 : data.ppg > 20 ? 0.12 : 0.06,
    pickAndRollBallHandlerFreq: data.pos === 'PG' ? 0.25 : data.pos === 'SG' ? 0.12 : 0.05,
    pickAndRollScreenerFreq: data.pos === 'C' ? 0.20 : data.pos === 'PF' ? 0.12 : 0.03,
    postUpFreq: data.pos === 'C' ? 0.15 : data.pos === 'PF' ? 0.08 : 0.02,
    spotUpFreq: 0.10 + threePtRate * 0.2,
    transitionFreq: data.archetype === 'slasher' ? 0.14 : 0.10,
    cutFreq: data.pos === 'SF' || data.pos === 'PF' ? 0.10 : 0.06,
    offScreenFreq: data.archetype === 'shooter' ? 0.12 : 0.06,
    handoffFreq: 0.05,
    threePointRate: threePtRate,
    midrangeRate: Math.max(0.10, 0.40 - threePtRate),
    rimRate: data.pos === 'C' ? 0.50 : data.pos === 'PF' ? 0.40 : 0.30,
    drawFoulRate: data.ppg > 20 ? 0.12 : 0.08,
    assistRate: data.apg / Math.max(1, data.ppg) * 3,
    usageRate: Math.min(0.35, data.ppg / 80),
    reboundRate: data.rpg / 15,
  };
}

function generateCareerStats(data: typeof TEAM_ROSTERS['BOS'][0]): Array<{
  season: string; teamId: string; gamesPlayed: number; gamesStarted: number;
  minutesPerGame: number; stats: PerGameStats;
}> {
  const currentSeason = {
    season: '2024-25',
    teamId: '',
    gamesPlayed: 65 + Math.floor(Math.random() * 17),
    gamesStarted: data.ppg > 10 ? 65 : 20,
    minutesPerGame: 20 + data.ppg * 0.6,
    stats: {
      points: data.ppg,
      fieldGoalsMade: data.ppg * data.fgPct / 2,
      fieldGoalsAttempted: data.ppg / 2,
      fieldGoalPct: data.fgPct,
      threePointersMade: data.tpa * data.threePct,
      threePointersAttempted: data.tpa,
      threePointPct: data.threePct,
      freeThrowsMade: data.ppg * 0.15,
      freeThrowsAttempted: data.ppg * 0.15 / data.ftPct,
      freeThrowPct: data.ftPct,
      offensiveRebounds: data.rpg * 0.25,
      defensiveRebounds: data.rpg * 0.75,
      rebounds: data.rpg,
      assists: data.apg,
      steals: data.spg,
      blocks: data.bpg,
      turnovers: data.apg * 0.5,
      personalFouls: 2.0,
    } as PerGameStats,
  };
  return [currentSeason];
}

function estimateSalary(ovr: number): number {
  if (ovr >= 75) return 40 + Math.random() * 10;
  if (ovr >= 65) return 25 + Math.random() * 10;
  if (ovr >= 55) return 12 + Math.random() * 8;
  if (ovr >= 45) return 5 + Math.random() * 5;
  return 1 + Math.random() * 3;
}

async function main() {
  console.log('Generating test data with real NBA players...\n');

  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }

  // Create all 30 teams but only populate key teams with detailed rosters
  const teams: Team[] = NBA_TEAMS.map((t, i) => ({
    id: `team_${i + 1}`,
    name: t.name,
    city: t.city,
    fullName: `${t.city} ${t.name}`,
    abbreviation: t.abbreviation,
    conference: t.conference,
    division: t.division,
    roster: [],
    rotation: { starters: ['', '', '', '', ''] as [string, string, string, string, string], rotationOrder: [], minuteTargets: {} },
    offensiveSystem: { pace: 98 + Math.random() * 8, threePointEmphasis: 0.4 + Math.random() * 0.3, transitionEmphasis: 0.3 + Math.random() * 0.4, postPlayEmphasis: 0.2 + Math.random() * 0.3, isolationEmphasis: 0.2 + Math.random() * 0.3, screeningEmphasis: 0.4 + Math.random() * 0.3 },
    defensiveSystem: { scheme: 'man' as const, intensity: 0.5 + Math.random() * 0.3, doubleTeamThreshold: 70, helpDefenseAggression: 0.5 },
  }));

  const allPlayers: Player[] = [];
  let playerIdCounter = 1;

  const teamByAbbr = (abbr: string) => teams.find((t) => t.abbreviation === abbr)!;

  // Populate detailed rosters
  for (const [abbr, roster] of Object.entries(TEAM_ROSTERS)) {
    const team = teamByAbbr(abbr);
    for (const playerData of roster) {
      const playerId = `player_${playerIdCounter++}`;
      const player = generatePlayerFromArchetype(playerData, team.id, playerId);
      player.careerStats[0].teamId = team.id;
      allPlayers.push(player);
      team.roster.push(playerId);
    }
  }

  // Generate basic rosters for remaining teams
  const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
  const genericFirstNames = ['James', 'Michael', 'Robert', 'David', 'Chris', 'Marcus', 'Kevin', 'Tyler', 'Brandon', 'Justin', 'Derek', 'Kyle'];
  const genericLastNames = ['Johnson', 'Williams', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White'];

  for (const team of teams) {
    if (team.roster.length > 0) continue; // Already populated

    for (let i = 0; i < 12; i++) {
      const playerId = `player_${playerIdCounter++}`;
      const pos = positions[i % 5];
      const isStarter = i < 5;
      const ovr = isStarter ? 40 + Math.floor(Math.random() * 25) : 28 + Math.floor(Math.random() * 20);
      const first = genericFirstNames[Math.floor(Math.random() * genericFirstNames.length)];
      const last = genericLastNames[Math.floor(Math.random() * genericLastNames.length)];

      const playerData = {
        first, last, pos, num: (i + 1) * 3, age: 22 + Math.floor(Math.random() * 12),
        ht: pos === 'C' ? 83 : pos === 'PF' ? 80 : pos === 'SF' ? 79 : 76,
        wt: pos === 'C' ? 245 : pos === 'PF' ? 230 : 200,
        exp: Math.floor(Math.random() * 8),
        ovr,
        archetype: (['shooter', 'slasher', 'playmaker', 'big', 'wing', 'two_way'] as const)[Math.floor(Math.random() * 6)],
        ppg: 5 + ovr * 0.35, rpg: 2 + (pos === 'C' ? 6 : pos === 'PF' ? 4 : 1) + Math.random() * 3,
        apg: pos === 'PG' ? 4 + Math.random() * 4 : 1 + Math.random() * 2,
        spg: 0.3 + Math.random() * 1.2, bpg: pos === 'C' ? 0.5 + Math.random() * 1.5 : Math.random() * 0.5,
        fgPct: 0.40 + Math.random() * 0.12, threePct: 0.30 + Math.random() * 0.10,
        ftPct: 0.65 + Math.random() * 0.20, tpa: pos === 'C' ? Math.random() * 2 : 2 + Math.random() * 5,
      };

      const player = generatePlayerFromArchetype(playerData, team.id, playerId);
      player.careerStats[0].teamId = team.id;
      allPlayers.push(player);
      team.roster.push(playerId);
    }
  }

  // Set up rotations
  for (const team of teams) {
    const teamPlayers = allPlayers.filter((p) => p.teamId === team.id);
    const sorted = teamPlayers.sort((a, b) => {
      const aOvr = Object.values(a.ratings).reduce((s, v) => s + v, 0) / 17;
      const bOvr = Object.values(b.ratings).reduce((s, v) => s + v, 0) / 17;
      return bOvr - aOvr;
    });

    const starters: string[] = [];
    const used = new Set<string>();

    for (const pos of positions) {
      const match = sorted.find((p) => p.position === pos && !used.has(p.id));
      if (match) {
        starters.push(match.id);
        used.add(match.id);
      }
    }
    while (starters.length < 5 && sorted.length > starters.length) {
      const next = sorted.find((p) => !used.has(p.id));
      if (next) {
        starters.push(next.id);
        used.add(next.id);
      } else break;
    }

    team.rotation = {
      starters: starters.slice(0, 5) as [string, string, string, string, string],
      rotationOrder: sorted.filter((p) => !used.has(p.id)).map((p) => p.id),
      minuteTargets: Object.fromEntries(
        sorted.map((p, i) => [p.id, Math.max(5, 34 - i * 3)])
      ),
    };
  }

  // Save
  await writeFile(path.join(DATA_DIR, 'teams.json'), JSON.stringify(teams, null, 2));
  await writeFile(path.join(DATA_DIR, 'players.json'), JSON.stringify(allPlayers, null, 2));

  console.log(`Created ${teams.length} teams`);
  console.log(`Created ${allPlayers.length} players`);
  console.log(`  - ${Object.keys(TEAM_ROSTERS).length} teams with real rosters (${Object.values(TEAM_ROSTERS).reduce((s, r) => s + r.length, 0)} real players)`);
  console.log(`  - ${teams.length - Object.keys(TEAM_ROSTERS).length} teams with generated rosters`);

  // Show top players
  const topPlayers = allPlayers
    .map((p) => ({ name: `${p.firstName} ${p.lastName}`, ovr: Math.round(Object.values(p.ratings).reduce((s, v) => s + v, 0) / 17) }))
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, 15);

  console.log('\nTop 15 Players:');
  topPlayers.forEach((p) => console.log(`  ${p.name}: ${p.ovr} OVR`));
}

main().catch(console.error);

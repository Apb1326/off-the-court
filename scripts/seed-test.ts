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
  ATL: [
    { first: 'Trae', last: 'Young', pos: 'PG', num: 11, age: 26, ht: 73, wt: 164, exp: 6, ovr: 66, archetype: 'playmaker', ppg: 24.2, rpg: 3.1, apg: 11.6, spg: 1.3, bpg: 0.2, fgPct: 0.418, threePct: 0.340, ftPct: 0.870, tpa: 7.0 },
    { first: 'Jalen', last: 'Johnson', pos: 'PF', num: 1, age: 23, ht: 80, wt: 220, exp: 3, ovr: 60, archetype: 'slasher', ppg: 18.9, rpg: 10.0, apg: 5.0, spg: 1.6, bpg: 1.0, fgPct: 0.505, threePct: 0.320, ftPct: 0.730, tpa: 3.0 },
    { first: 'Dyson', last: 'Daniels', pos: 'SG', num: 5, age: 21, ht: 79, wt: 199, exp: 2, ovr: 54, archetype: 'two_way', ppg: 14.1, rpg: 5.9, apg: 4.4, spg: 3.0, bpg: 0.7, fgPct: 0.490, threePct: 0.340, ftPct: 0.740, tpa: 3.0 },
    { first: 'Zaccharie', last: 'Risacher', pos: 'SF', num: 10, age: 19, ht: 81, wt: 200, exp: 1, ovr: 48, archetype: 'wing', ppg: 12.6, rpg: 3.6, apg: 1.2, spg: 0.7, bpg: 0.6, fgPct: 0.455, threePct: 0.355, ftPct: 0.770, tpa: 4.0 },
    { first: 'Onyeka', last: 'Okongwu', pos: 'C', num: 17, age: 24, ht: 81, wt: 240, exp: 4, ovr: 52, archetype: 'big', ppg: 13.0, rpg: 8.7, apg: 2.2, spg: 0.9, bpg: 1.3, fgPct: 0.570, threePct: 0.350, ftPct: 0.740, tpa: 1.5 },
    { first: 'Clint', last: 'Capela', pos: 'C', num: 15, age: 30, ht: 82, wt: 256, exp: 11, ovr: 48, archetype: 'rim_protector', ppg: 8.9, rpg: 8.5, apg: 1.0, spg: 0.6, bpg: 1.2, fgPct: 0.595, threePct: 0.000, ftPct: 0.560, tpa: 0.0 },
    { first: 'Bogdan', last: 'Bogdanovic', pos: 'SG', num: 13, age: 32, ht: 78, wt: 220, exp: 7, ovr: 50, archetype: 'shooter', ppg: 16.0, rpg: 3.2, apg: 3.2, spg: 1.1, bpg: 0.2, fgPct: 0.430, threePct: 0.375, ftPct: 0.870, tpa: 7.0 },
    { first: 'De\'Andre', last: 'Hunter', pos: 'SF', num: 12, age: 27, ht: 80, wt: 221, exp: 5, ovr: 52, archetype: 'wing', ppg: 19.0, rpg: 3.8, apg: 1.5, spg: 0.6, bpg: 0.4, fgPct: 0.470, threePct: 0.390, ftPct: 0.840, tpa: 5.5 },
    { first: 'Larry', last: 'Nance Jr.', pos: 'PF', num: 22, age: 32, ht: 80, wt: 245, exp: 9, ovr: 40, archetype: 'stretch_big', ppg: 6.5, rpg: 5.0, apg: 1.8, spg: 0.8, bpg: 0.5, fgPct: 0.560, threePct: 0.350, ftPct: 0.700, tpa: 1.5 },
    { first: 'Garrison', last: 'Mathews', pos: 'SG', num: 25, age: 28, ht: 77, wt: 215, exp: 5, ovr: 38, archetype: 'shooter', ppg: 6.0, rpg: 1.8, apg: 1.0, spg: 0.4, bpg: 0.2, fgPct: 0.420, threePct: 0.380, ftPct: 0.850, tpa: 4.0 },
  ],
  BKN: [
    { first: 'Cam', last: 'Thomas', pos: 'SG', num: 24, age: 23, ht: 75, wt: 210, exp: 3, ovr: 54, archetype: 'slasher', ppg: 24.0, rpg: 3.3, apg: 3.8, spg: 0.8, bpg: 0.3, fgPct: 0.435, threePct: 0.343, ftPct: 0.870, tpa: 7.0 },
    { first: 'Cameron', last: 'Johnson', pos: 'SF', num: 2, age: 28, ht: 80, wt: 210, exp: 5, ovr: 54, archetype: 'shooter', ppg: 18.8, rpg: 4.3, apg: 3.4, spg: 0.9, bpg: 0.5, fgPct: 0.475, threePct: 0.390, ftPct: 0.880, tpa: 6.5 },
    { first: 'Dennis', last: 'Schroder', pos: 'PG', num: 17, age: 31, ht: 73, wt: 172, exp: 11, ovr: 50, archetype: 'playmaker', ppg: 18.4, rpg: 3.0, apg: 6.6, spg: 1.0, bpg: 0.2, fgPct: 0.435, threePct: 0.340, ftPct: 0.850, tpa: 5.5 },
    { first: 'Nic', last: 'Claxton', pos: 'C', num: 33, age: 25, ht: 83, wt: 215, exp: 5, ovr: 52, archetype: 'rim_protector', ppg: 10.0, rpg: 9.0, apg: 2.1, spg: 0.8, bpg: 1.4, fgPct: 0.560, threePct: 0.250, ftPct: 0.560, tpa: 0.3 },
    { first: 'Dorian', last: 'Finney-Smith', pos: 'PF', num: 28, age: 31, ht: 79, wt: 220, exp: 8, ovr: 48, archetype: 'two_way', ppg: 10.4, rpg: 4.6, apg: 1.5, spg: 0.9, bpg: 0.6, fgPct: 0.460, threePct: 0.410, ftPct: 0.720, tpa: 4.5 },
    { first: 'Day\'Ron', last: 'Sharpe', pos: 'C', num: 20, age: 23, ht: 81, wt: 265, exp: 3, ovr: 42, archetype: 'big', ppg: 7.8, rpg: 6.5, apg: 1.6, spg: 0.8, bpg: 0.7, fgPct: 0.540, threePct: 0.200, ftPct: 0.680, tpa: 0.3 },
    { first: 'Ziaire', last: 'Williams', pos: 'SF', num: 8, age: 23, ht: 81, wt: 185, exp: 3, ovr: 42, archetype: 'wing', ppg: 10.0, rpg: 3.9, apg: 1.6, spg: 0.7, bpg: 0.3, fgPct: 0.435, threePct: 0.340, ftPct: 0.780, tpa: 4.0 },
    { first: 'Keon', last: 'Johnson', pos: 'SG', num: 45, age: 22, ht: 76, wt: 185, exp: 3, ovr: 40, archetype: 'slasher', ppg: 10.5, rpg: 3.0, apg: 3.0, spg: 0.9, bpg: 0.3, fgPct: 0.420, threePct: 0.340, ftPct: 0.800, tpa: 4.0 },
    { first: 'Noah', last: 'Clowney', pos: 'PF', num: 21, age: 20, ht: 82, wt: 210, exp: 2, ovr: 40, archetype: 'stretch_big', ppg: 8.0, rpg: 4.0, apg: 0.8, spg: 0.5, bpg: 0.7, fgPct: 0.400, threePct: 0.330, ftPct: 0.730, tpa: 4.5 },
    { first: 'Shake', last: 'Milton', pos: 'PG', num: 11, age: 28, ht: 77, wt: 205, exp: 7, ovr: 36, archetype: 'shooter', ppg: 6.5, rpg: 2.0, apg: 2.5, spg: 0.4, bpg: 0.2, fgPct: 0.430, threePct: 0.360, ftPct: 0.840, tpa: 3.0 },
  ],
  CHA: [
    { first: 'LaMelo', last: 'Ball', pos: 'PG', num: 1, age: 23, ht: 79, wt: 180, exp: 4, ovr: 60, archetype: 'playmaker', ppg: 25.2, rpg: 4.9, apg: 7.4, spg: 1.1, bpg: 0.3, fgPct: 0.413, threePct: 0.337, ftPct: 0.870, tpa: 10.5 },
    { first: 'Brandon', last: 'Miller', pos: 'SF', num: 24, age: 22, ht: 81, wt: 200, exp: 2, ovr: 56, archetype: 'wing', ppg: 21.0, rpg: 4.9, apg: 3.6, spg: 0.9, bpg: 0.5, fgPct: 0.410, threePct: 0.355, ftPct: 0.860, tpa: 8.0 },
    { first: 'Miles', last: 'Bridges', pos: 'PF', num: 0, age: 26, ht: 78, wt: 225, exp: 6, ovr: 54, archetype: 'slasher', ppg: 20.0, rpg: 7.5, apg: 3.2, spg: 1.0, bpg: 0.6, fgPct: 0.460, threePct: 0.350, ftPct: 0.790, tpa: 5.5 },
    { first: 'Mark', last: 'Williams', pos: 'C', num: 5, age: 23, ht: 84, wt: 240, exp: 2, ovr: 50, archetype: 'rim_protector', ppg: 15.3, rpg: 9.7, apg: 2.5, spg: 0.7, bpg: 1.2, fgPct: 0.600, threePct: 0.000, ftPct: 0.730, tpa: 0.1 },
    { first: 'Josh', last: 'Green', pos: 'SG', num: 14, age: 24, ht: 78, wt: 200, exp: 4, ovr: 44, archetype: 'two_way', ppg: 8.5, rpg: 3.0, apg: 2.5, spg: 0.9, bpg: 0.3, fgPct: 0.450, threePct: 0.380, ftPct: 0.760, tpa: 4.0 },
    { first: 'Tre', last: 'Mann', pos: 'PG', num: 23, age: 23, ht: 75, wt: 184, exp: 3, ovr: 42, archetype: 'shooter', ppg: 12.0, rpg: 2.8, apg: 3.5, spg: 0.8, bpg: 0.2, fgPct: 0.430, threePct: 0.360, ftPct: 0.840, tpa: 5.0 },
    { first: 'Cody', last: 'Martin', pos: 'SF', num: 11, age: 29, ht: 78, wt: 205, exp: 5, ovr: 40, archetype: 'two_way', ppg: 7.0, rpg: 4.0, apg: 2.2, spg: 0.9, bpg: 0.3, fgPct: 0.440, threePct: 0.330, ftPct: 0.700, tpa: 2.5 },
    { first: 'Nick', last: 'Richards', pos: 'C', num: 4, age: 27, ht: 83, wt: 245, exp: 4, ovr: 42, archetype: 'big', ppg: 9.0, rpg: 7.5, apg: 1.0, spg: 0.4, bpg: 1.0, fgPct: 0.620, threePct: 0.000, ftPct: 0.700, tpa: 0.1 },
    { first: 'Vasilije', last: 'Micic', pos: 'PG', num: 22, age: 30, ht: 77, wt: 200, exp: 2, ovr: 38, archetype: 'playmaker', ppg: 8.0, rpg: 2.3, apg: 4.5, spg: 0.7, bpg: 0.1, fgPct: 0.420, threePct: 0.330, ftPct: 0.820, tpa: 3.0 },
    { first: 'Moussa', last: 'Diabate', pos: 'PF', num: 20, age: 23, ht: 82, wt: 210, exp: 2, ovr: 36, archetype: 'big', ppg: 5.5, rpg: 5.5, apg: 0.8, spg: 0.6, bpg: 0.6, fgPct: 0.580, threePct: 0.000, ftPct: 0.600, tpa: 0.1 },
  ],
  CHI: [
    { first: 'Coby', last: 'White', pos: 'SG', num: 0, age: 25, ht: 76, wt: 195, exp: 5, ovr: 56, archetype: 'shooter', ppg: 20.4, rpg: 3.7, apg: 4.5, spg: 0.9, bpg: 0.2, fgPct: 0.450, threePct: 0.370, ftPct: 0.890, tpa: 8.0 },
    { first: 'Nikola', last: 'Vucevic', pos: 'C', num: 9, age: 34, ht: 82, wt: 260, exp: 13, ovr: 56, archetype: 'stretch_big', ppg: 18.5, rpg: 10.1, apg: 3.5, spg: 0.7, bpg: 0.7, fgPct: 0.530, threePct: 0.400, ftPct: 0.760, tpa: 4.0 },
    { first: 'Zach', last: 'LaVine', pos: 'SG', num: 8, age: 29, ht: 77, wt: 200, exp: 10, ovr: 58, archetype: 'slasher', ppg: 24.0, rpg: 4.6, apg: 4.2, spg: 0.9, bpg: 0.3, fgPct: 0.510, threePct: 0.440, ftPct: 0.870, tpa: 7.0 },
    { first: 'Josh', last: 'Giddey', pos: 'PG', num: 3, age: 22, ht: 80, wt: 216, exp: 3, ovr: 54, archetype: 'playmaker', ppg: 14.6, rpg: 8.1, apg: 7.5, spg: 1.2, bpg: 0.6, fgPct: 0.475, threePct: 0.360, ftPct: 0.780, tpa: 4.0 },
    { first: 'Patrick', last: 'Williams', pos: 'PF', num: 44, age: 23, ht: 79, wt: 215, exp: 4, ovr: 46, archetype: 'wing', ppg: 9.0, rpg: 4.0, apg: 1.5, spg: 0.7, bpg: 0.6, fgPct: 0.440, threePct: 0.350, ftPct: 0.800, tpa: 4.0 },
    { first: 'Ayo', last: 'Dosunmu', pos: 'SG', num: 12, age: 25, ht: 76, wt: 200, exp: 4, ovr: 46, archetype: 'two_way', ppg: 12.0, rpg: 3.3, apg: 4.5, spg: 1.0, bpg: 0.5, fgPct: 0.480, threePct: 0.340, ftPct: 0.800, tpa: 3.0 },
    { first: 'Jevon', last: 'Carter', pos: 'PG', num: 5, age: 29, ht: 73, wt: 200, exp: 6, ovr: 38, archetype: 'two_way', ppg: 4.0, rpg: 1.5, apg: 1.8, spg: 0.7, bpg: 0.2, fgPct: 0.400, threePct: 0.350, ftPct: 0.800, tpa: 2.5 },
    { first: 'Jalen', last: 'Smith', pos: 'PF', num: 7, age: 25, ht: 82, wt: 215, exp: 5, ovr: 42, archetype: 'stretch_big', ppg: 9.0, rpg: 6.0, apg: 0.9, spg: 0.5, bpg: 0.8, fgPct: 0.520, threePct: 0.360, ftPct: 0.760, tpa: 2.5 },
    { first: 'Talen', last: 'Horton-Tucker', pos: 'SF', num: 6, age: 24, ht: 76, wt: 234, exp: 5, ovr: 40, archetype: 'slasher', ppg: 9.5, rpg: 3.0, apg: 3.5, spg: 0.9, bpg: 0.3, fgPct: 0.450, threePct: 0.320, ftPct: 0.770, tpa: 2.5 },
    { first: 'Dalen', last: 'Terry', pos: 'SF', num: 25, age: 22, ht: 79, wt: 195, exp: 3, ovr: 36, archetype: 'wing', ppg: 5.0, rpg: 2.5, apg: 2.0, spg: 0.7, bpg: 0.2, fgPct: 0.450, threePct: 0.330, ftPct: 0.720, tpa: 2.0 },
  ],
  CLE: [
    { first: 'Donovan', last: 'Mitchell', pos: 'SG', num: 45, age: 28, ht: 75, wt: 215, exp: 7, ovr: 70, archetype: 'slasher', ppg: 24.0, rpg: 4.5, apg: 5.0, spg: 1.3, bpg: 0.5, fgPct: 0.460, threePct: 0.365, ftPct: 0.820, tpa: 8.5 },
    { first: 'Darius', last: 'Garland', pos: 'PG', num: 10, age: 25, ht: 73, wt: 192, exp: 5, ovr: 62, archetype: 'playmaker', ppg: 20.6, rpg: 2.9, apg: 6.7, spg: 1.2, bpg: 0.1, fgPct: 0.470, threePct: 0.400, ftPct: 0.870, tpa: 6.0 },
    { first: 'Evan', last: 'Mobley', pos: 'PF', num: 4, age: 23, ht: 84, wt: 215, exp: 4, ovr: 64, archetype: 'two_way', ppg: 18.5, rpg: 9.3, apg: 3.2, spg: 0.9, bpg: 1.6, fgPct: 0.550, threePct: 0.370, ftPct: 0.740, tpa: 3.0 },
    { first: 'Jarrett', last: 'Allen', pos: 'C', num: 31, age: 26, ht: 83, wt: 243, exp: 7, ovr: 60, archetype: 'rim_protector', ppg: 13.5, rpg: 9.8, apg: 1.7, spg: 0.8, bpg: 1.1, fgPct: 0.700, threePct: 0.000, ftPct: 0.720, tpa: 0.1 },
    { first: 'Max', last: 'Strus', pos: 'SF', num: 1, age: 28, ht: 78, wt: 215, exp: 5, ovr: 50, archetype: 'shooter', ppg: 12.0, rpg: 4.5, apg: 3.5, spg: 0.8, bpg: 0.3, fgPct: 0.450, threePct: 0.390, ftPct: 0.800, tpa: 6.5 },
    { first: 'De\'Andre', last: 'Hunter', pos: 'SF', num: 12, age: 27, ht: 80, wt: 221, exp: 5, ovr: 52, archetype: 'wing', ppg: 18.0, rpg: 3.8, apg: 1.5, spg: 0.6, bpg: 0.4, fgPct: 0.470, threePct: 0.400, ftPct: 0.840, tpa: 5.5 },
    { first: 'Ty', last: 'Jerome', pos: 'PG', num: 2, age: 27, ht: 77, wt: 195, exp: 5, ovr: 48, archetype: 'shooter', ppg: 12.5, rpg: 2.5, apg: 3.4, spg: 0.9, bpg: 0.2, fgPct: 0.510, threePct: 0.440, ftPct: 0.870, tpa: 4.0 },
    { first: 'Caris', last: 'LeVert', pos: 'SG', num: 3, age: 30, ht: 78, wt: 205, exp: 8, ovr: 48, archetype: 'slasher', ppg: 11.0, rpg: 3.5, apg: 3.8, spg: 1.0, bpg: 0.3, fgPct: 0.440, threePct: 0.340, ftPct: 0.770, tpa: 4.0 },
    { first: 'Dean', last: 'Wade', pos: 'PF', num: 32, age: 28, ht: 81, wt: 228, exp: 6, ovr: 42, archetype: 'stretch_big', ppg: 5.0, rpg: 3.5, apg: 1.2, spg: 0.6, bpg: 0.5, fgPct: 0.440, threePct: 0.380, ftPct: 0.750, tpa: 3.0 },
    { first: 'Isaac', last: 'Okoro', pos: 'SF', num: 35, age: 24, ht: 77, wt: 225, exp: 5, ovr: 44, archetype: 'two_way', ppg: 6.5, rpg: 2.7, apg: 1.4, spg: 0.7, bpg: 0.3, fgPct: 0.480, threePct: 0.380, ftPct: 0.700, tpa: 3.0 },
  ],
  DET: [
    { first: 'Cade', last: 'Cunningham', pos: 'PG', num: 2, age: 23, ht: 78, wt: 220, exp: 4, ovr: 64, archetype: 'playmaker', ppg: 26.1, rpg: 6.1, apg: 9.1, spg: 1.0, bpg: 0.8, fgPct: 0.460, threePct: 0.355, ftPct: 0.840, tpa: 6.0 },
    { first: 'Jaden', last: 'Ivey', pos: 'SG', num: 23, age: 22, ht: 76, wt: 195, exp: 3, ovr: 52, archetype: 'slasher', ppg: 17.6, rpg: 4.1, apg: 4.0, spg: 0.9, bpg: 0.4, fgPct: 0.460, threePct: 0.410, ftPct: 0.730, tpa: 5.0 },
    { first: 'Jalen', last: 'Duren', pos: 'C', num: 0, age: 21, ht: 82, wt: 250, exp: 3, ovr: 52, archetype: 'big', ppg: 12.5, rpg: 10.3, apg: 2.5, spg: 0.9, bpg: 1.0, fgPct: 0.630, threePct: 0.000, ftPct: 0.730, tpa: 0.1 },
    { first: 'Tobias', last: 'Harris', pos: 'PF', num: 12, age: 32, ht: 80, wt: 226, exp: 13, ovr: 50, archetype: 'wing', ppg: 13.7, rpg: 6.0, apg: 2.5, spg: 0.8, bpg: 0.6, fgPct: 0.480, threePct: 0.350, ftPct: 0.840, tpa: 4.0 },
    { first: 'Tim', last: 'Hardaway Jr.', pos: 'SG', num: 10, age: 32, ht: 77, wt: 205, exp: 11, ovr: 46, archetype: 'shooter', ppg: 11.0, rpg: 2.5, apg: 1.6, spg: 0.6, bpg: 0.2, fgPct: 0.420, threePct: 0.370, ftPct: 0.800, tpa: 6.5 },
    { first: 'Malik', last: 'Beasley', pos: 'SG', num: 5, age: 28, ht: 76, wt: 187, exp: 8, ovr: 48, archetype: 'shooter', ppg: 16.3, rpg: 2.6, apg: 1.7, spg: 0.7, bpg: 0.1, fgPct: 0.430, threePct: 0.415, ftPct: 0.800, tpa: 9.0 },
    { first: 'Ausar', last: 'Thompson', pos: 'SF', num: 9, age: 22, ht: 79, wt: 215, exp: 2, ovr: 48, archetype: 'two_way', ppg: 10.0, rpg: 6.5, apg: 3.0, spg: 1.4, bpg: 1.1, fgPct: 0.530, threePct: 0.240, ftPct: 0.650, tpa: 1.0 },
    { first: 'Isaiah', last: 'Stewart', pos: 'C', num: 28, age: 23, ht: 80, wt: 250, exp: 5, ovr: 44, archetype: 'rim_protector', ppg: 6.0, rpg: 6.0, apg: 1.2, spg: 0.6, bpg: 1.3, fgPct: 0.500, threePct: 0.350, ftPct: 0.730, tpa: 2.0 },
    { first: 'Marcus', last: 'Sasser', pos: 'PG', num: 25, age: 24, ht: 73, wt: 195, exp: 2, ovr: 40, archetype: 'shooter', ppg: 8.5, rpg: 1.8, apg: 2.8, spg: 0.7, bpg: 0.1, fgPct: 0.430, threePct: 0.360, ftPct: 0.840, tpa: 3.5 },
    { first: 'Ronald', last: 'Holland', pos: 'SF', num: 0, age: 19, ht: 79, wt: 200, exp: 1, ovr: 38, archetype: 'slasher', ppg: 6.0, rpg: 3.0, apg: 1.2, spg: 0.8, bpg: 0.4, fgPct: 0.500, threePct: 0.240, ftPct: 0.700, tpa: 1.0 },
  ],
  IND: [
    { first: 'Tyrese', last: 'Haliburton', pos: 'PG', num: 0, age: 24, ht: 77, wt: 185, exp: 5, ovr: 64, archetype: 'playmaker', ppg: 18.6, rpg: 3.5, apg: 9.2, spg: 1.4, bpg: 0.7, fgPct: 0.475, threePct: 0.390, ftPct: 0.850, tpa: 7.0 },
    { first: 'Pascal', last: 'Siakam', pos: 'PF', num: 43, age: 30, ht: 80, wt: 230, exp: 9, ovr: 62, archetype: 'slasher', ppg: 20.2, rpg: 6.9, apg: 3.4, spg: 0.9, bpg: 0.5, fgPct: 0.520, threePct: 0.385, ftPct: 0.780, tpa: 3.5 },
    { first: 'Myles', last: 'Turner', pos: 'C', num: 33, age: 28, ht: 83, wt: 250, exp: 9, ovr: 56, archetype: 'stretch_big', ppg: 15.6, rpg: 6.5, apg: 1.5, spg: 0.7, bpg: 2.0, fgPct: 0.480, threePct: 0.395, ftPct: 0.770, tpa: 4.5 },
    { first: 'Bennedict', last: 'Mathurin', pos: 'SG', num: 0, age: 22, ht: 78, wt: 210, exp: 3, ovr: 52, archetype: 'slasher', ppg: 16.1, rpg: 5.9, apg: 1.9, spg: 0.6, bpg: 0.3, fgPct: 0.455, threePct: 0.350, ftPct: 0.825, tpa: 4.5 },
    { first: 'Andrew', last: 'Nembhard', pos: 'SG', num: 2, age: 24, ht: 77, wt: 191, exp: 3, ovr: 50, archetype: 'two_way', ppg: 10.0, rpg: 3.3, apg: 5.0, spg: 1.3, bpg: 0.3, fgPct: 0.470, threePct: 0.290, ftPct: 0.770, tpa: 3.0 },
    { first: 'Aaron', last: 'Nesmith', pos: 'SF', num: 23, age: 25, ht: 78, wt: 215, exp: 5, ovr: 48, archetype: 'two_way', ppg: 12.0, rpg: 4.5, apg: 1.5, spg: 0.8, bpg: 0.4, fgPct: 0.500, threePct: 0.430, ftPct: 0.820, tpa: 4.5 },
    { first: 'Obi', last: 'Toppin', pos: 'PF', num: 1, age: 26, ht: 81, wt: 220, exp: 5, ovr: 46, archetype: 'slasher', ppg: 10.5, rpg: 4.0, apg: 1.8, spg: 0.7, bpg: 0.4, fgPct: 0.540, threePct: 0.370, ftPct: 0.770, tpa: 3.0 },
    { first: 'T.J.', last: 'McConnell', pos: 'PG', num: 9, age: 32, ht: 73, wt: 190, exp: 10, ovr: 46, archetype: 'playmaker', ppg: 9.0, rpg: 2.7, apg: 5.0, spg: 1.2, bpg: 0.1, fgPct: 0.530, threePct: 0.330, ftPct: 0.800, tpa: 0.8 },
    { first: 'Ben', last: 'Sheppard', pos: 'SG', num: 26, age: 23, ht: 78, wt: 190, exp: 2, ovr: 40, archetype: 'shooter', ppg: 7.0, rpg: 2.5, apg: 1.7, spg: 0.7, bpg: 0.2, fgPct: 0.440, threePct: 0.380, ftPct: 0.800, tpa: 3.5 },
    { first: 'Isaiah', last: 'Jackson', pos: 'C', num: 22, age: 22, ht: 82, wt: 205, exp: 3, ovr: 42, archetype: 'rim_protector', ppg: 8.0, rpg: 6.0, apg: 1.0, spg: 0.6, bpg: 1.3, fgPct: 0.640, threePct: 0.000, ftPct: 0.680, tpa: 0.1 },
  ],
  MIA: [
    { first: 'Jimmy', last: 'Butler', pos: 'SF', num: 22, age: 35, ht: 79, wt: 230, exp: 13, ovr: 60, archetype: 'slasher', ppg: 18.0, rpg: 5.4, apg: 4.9, spg: 1.3, bpg: 0.3, fgPct: 0.540, threePct: 0.330, ftPct: 0.840, tpa: 2.0 },
    { first: 'Bam', last: 'Adebayo', pos: 'C', num: 13, age: 27, ht: 81, wt: 255, exp: 8, ovr: 62, archetype: 'two_way', ppg: 18.1, rpg: 9.6, apg: 4.0, spg: 1.1, bpg: 0.9, fgPct: 0.510, threePct: 0.350, ftPct: 0.760, tpa: 2.0 },
    { first: 'Tyler', last: 'Herro', pos: 'SG', num: 14, age: 25, ht: 77, wt: 195, exp: 6, ovr: 58, archetype: 'shooter', ppg: 23.9, rpg: 5.2, apg: 5.5, spg: 0.9, bpg: 0.3, fgPct: 0.470, threePct: 0.375, ftPct: 0.880, tpa: 8.0 },
    { first: 'Terry', last: 'Rozier', pos: 'PG', num: 2, age: 30, ht: 73, wt: 190, exp: 9, ovr: 48, archetype: 'shooter', ppg: 12.0, rpg: 3.5, apg: 3.5, spg: 1.0, bpg: 0.3, fgPct: 0.410, threePct: 0.320, ftPct: 0.830, tpa: 6.0 },
    { first: 'Haywood', last: 'Highsmith', pos: 'PF', num: 24, age: 28, ht: 79, wt: 220, exp: 5, ovr: 44, archetype: 'two_way', ppg: 6.5, rpg: 4.0, apg: 1.7, spg: 0.9, bpg: 0.5, fgPct: 0.450, threePct: 0.370, ftPct: 0.730, tpa: 3.5 },
    { first: 'Nikola', last: 'Jovic', pos: 'PF', num: 5, age: 21, ht: 82, wt: 230, exp: 3, ovr: 46, archetype: 'stretch_big', ppg: 10.7, rpg: 4.0, apg: 3.0, spg: 0.7, bpg: 0.4, fgPct: 0.450, threePct: 0.360, ftPct: 0.780, tpa: 4.0 },
    { first: 'Davion', last: 'Mitchell', pos: 'PG', num: 45, age: 26, ht: 74, wt: 202, exp: 4, ovr: 42, archetype: 'two_way', ppg: 6.0, rpg: 2.0, apg: 4.0, spg: 0.9, bpg: 0.2, fgPct: 0.450, threePct: 0.380, ftPct: 0.800, tpa: 2.5 },
    { first: 'Duncan', last: 'Robinson', pos: 'SF', num: 55, age: 30, ht: 79, wt: 215, exp: 7, ovr: 46, archetype: 'shooter', ppg: 11.0, rpg: 2.5, apg: 2.5, spg: 0.4, bpg: 0.1, fgPct: 0.440, threePct: 0.395, ftPct: 0.850, tpa: 7.0 },
    { first: 'Kel\'el', last: 'Ware', pos: 'C', num: 7, age: 20, ht: 84, wt: 230, exp: 1, ovr: 44, archetype: 'big', ppg: 9.0, rpg: 7.5, apg: 1.0, spg: 0.5, bpg: 1.1, fgPct: 0.570, threePct: 0.330, ftPct: 0.700, tpa: 1.0 },
    { first: 'Jaime', last: 'Jaquez Jr.', pos: 'SF', num: 11, age: 24, ht: 78, wt: 226, exp: 2, ovr: 46, archetype: 'wing', ppg: 9.0, rpg: 3.8, apg: 2.5, spg: 0.8, bpg: 0.3, fgPct: 0.490, threePct: 0.300, ftPct: 0.730, tpa: 2.0 },
  ],
  NYK: [
    { first: 'Jalen', last: 'Brunson', pos: 'PG', num: 11, age: 28, ht: 73, wt: 190, exp: 6, ovr: 66, archetype: 'slasher', ppg: 26.0, rpg: 3.0, apg: 7.3, spg: 0.9, bpg: 0.2, fgPct: 0.485, threePct: 0.385, ftPct: 0.840, tpa: 5.5 },
    { first: 'Karl-Anthony', last: 'Towns', pos: 'C', num: 32, age: 29, ht: 83, wt: 248, exp: 9, ovr: 64, archetype: 'stretch_big', ppg: 24.4, rpg: 12.8, apg: 3.1, spg: 1.0, bpg: 0.7, fgPct: 0.530, threePct: 0.420, ftPct: 0.860, tpa: 4.5 },
    { first: 'Mikal', last: 'Bridges', pos: 'SF', num: 25, age: 28, ht: 78, wt: 209, exp: 6, ovr: 58, archetype: 'two_way', ppg: 17.6, rpg: 3.2, apg: 3.6, spg: 0.9, bpg: 0.5, fgPct: 0.500, threePct: 0.355, ftPct: 0.810, tpa: 5.0 },
    { first: 'OG', last: 'Anunoby', pos: 'SF', num: 8, age: 27, ht: 79, wt: 232, exp: 7, ovr: 56, archetype: 'two_way', ppg: 16.5, rpg: 4.8, apg: 2.3, spg: 1.5, bpg: 0.7, fgPct: 0.490, threePct: 0.380, ftPct: 0.790, tpa: 5.0 },
    { first: 'Josh', last: 'Hart', pos: 'SG', num: 3, age: 29, ht: 76, wt: 215, exp: 7, ovr: 54, archetype: 'two_way', ppg: 13.6, rpg: 9.6, apg: 5.9, spg: 1.5, bpg: 0.3, fgPct: 0.520, threePct: 0.330, ftPct: 0.760, tpa: 3.0 },
    { first: 'Mitchell', last: 'Robinson', pos: 'C', num: 23, age: 26, ht: 84, wt: 240, exp: 6, ovr: 46, archetype: 'rim_protector', ppg: 5.5, rpg: 8.5, apg: 0.9, spg: 0.7, bpg: 1.4, fgPct: 0.650, threePct: 0.000, ftPct: 0.550, tpa: 0.0 },
    { first: 'Miles', last: 'McBride', pos: 'PG', num: 2, age: 24, ht: 73, wt: 195, exp: 4, ovr: 46, archetype: 'two_way', ppg: 9.5, rpg: 2.5, apg: 2.8, spg: 1.0, bpg: 0.2, fgPct: 0.430, threePct: 0.370, ftPct: 0.850, tpa: 4.5 },
    { first: 'Cameron', last: 'Payne', pos: 'PG', num: 1, age: 30, ht: 73, wt: 183, exp: 9, ovr: 40, archetype: 'shooter', ppg: 6.5, rpg: 1.8, apg: 3.0, spg: 0.6, bpg: 0.1, fgPct: 0.430, threePct: 0.360, ftPct: 0.870, tpa: 3.0 },
    { first: 'Precious', last: 'Achiuwa', pos: 'PF', num: 5, age: 25, ht: 80, wt: 243, exp: 5, ovr: 42, archetype: 'big', ppg: 6.0, rpg: 6.5, apg: 1.2, spg: 0.6, bpg: 0.7, fgPct: 0.500, threePct: 0.260, ftPct: 0.600, tpa: 0.8 },
    { first: 'Tyler', last: 'Kolek', pos: 'PG', num: 13, age: 23, ht: 75, wt: 195, exp: 1, ovr: 36, archetype: 'playmaker', ppg: 4.0, rpg: 1.8, apg: 3.0, spg: 0.6, bpg: 0.1, fgPct: 0.420, threePct: 0.330, ftPct: 0.800, tpa: 2.0 },
  ],
  ORL: [
    { first: 'Paolo', last: 'Banchero', pos: 'PF', num: 5, age: 22, ht: 80, wt: 250, exp: 3, ovr: 62, archetype: 'slasher', ppg: 25.9, rpg: 7.5, apg: 4.8, spg: 0.9, bpg: 0.7, fgPct: 0.450, threePct: 0.320, ftPct: 0.730, tpa: 5.0 },
    { first: 'Franz', last: 'Wagner', pos: 'SF', num: 22, age: 23, ht: 82, wt: 220, exp: 4, ovr: 60, archetype: 'slasher', ppg: 24.2, rpg: 5.7, apg: 4.7, spg: 1.3, bpg: 0.6, fgPct: 0.480, threePct: 0.300, ftPct: 0.860, tpa: 4.5 },
    { first: 'Jalen', last: 'Suggs', pos: 'PG', num: 4, age: 23, ht: 76, wt: 205, exp: 4, ovr: 52, archetype: 'two_way', ppg: 16.2, rpg: 4.0, apg: 3.7, spg: 1.5, bpg: 0.5, fgPct: 0.430, threePct: 0.310, ftPct: 0.780, tpa: 6.0 },
    { first: 'Wendell', last: 'Carter Jr.', pos: 'C', num: 34, age: 25, ht: 82, wt: 270, exp: 6, ovr: 50, archetype: 'big', ppg: 11.0, rpg: 8.0, apg: 2.2, spg: 0.7, bpg: 0.6, fgPct: 0.500, threePct: 0.340, ftPct: 0.770, tpa: 2.5 },
    { first: 'Kentavious', last: 'Caldwell-Pope', pos: 'SG', num: 1, age: 31, ht: 77, wt: 204, exp: 11, ovr: 48, archetype: 'two_way', ppg: 8.7, rpg: 2.4, apg: 2.4, spg: 1.1, bpg: 0.3, fgPct: 0.430, threePct: 0.350, ftPct: 0.830, tpa: 4.5 },
    { first: 'Cole', last: 'Anthony', pos: 'PG', num: 50, age: 24, ht: 75, wt: 185, exp: 5, ovr: 44, archetype: 'shooter', ppg: 9.4, rpg: 3.6, apg: 3.4, spg: 0.6, bpg: 0.2, fgPct: 0.410, threePct: 0.330, ftPct: 0.820, tpa: 3.5 },
    { first: 'Anthony', last: 'Black', pos: 'SG', num: 0, age: 21, ht: 79, wt: 200, exp: 2, ovr: 44, archetype: 'two_way', ppg: 8.5, rpg: 3.5, apg: 2.8, spg: 1.0, bpg: 0.5, fgPct: 0.460, threePct: 0.330, ftPct: 0.770, tpa: 2.5 },
    { first: 'Gary', last: 'Harris', pos: 'SG', num: 14, age: 30, ht: 76, wt: 210, exp: 11, ovr: 40, archetype: 'shooter', ppg: 5.0, rpg: 1.8, apg: 1.5, spg: 0.7, bpg: 0.2, fgPct: 0.430, threePct: 0.380, ftPct: 0.770, tpa: 3.0 },
    { first: 'Jonathan', last: 'Isaac', pos: 'PF', num: 1, age: 27, ht: 83, wt: 230, exp: 6, ovr: 44, archetype: 'rim_protector', ppg: 7.0, rpg: 4.5, apg: 0.8, spg: 0.8, bpg: 1.3, fgPct: 0.520, threePct: 0.330, ftPct: 0.700, tpa: 1.5 },
    { first: 'Goga', last: 'Bitadze', pos: 'C', num: 35, age: 25, ht: 83, wt: 250, exp: 5, ovr: 42, archetype: 'rim_protector', ppg: 7.5, rpg: 6.5, apg: 1.5, spg: 0.6, bpg: 1.3, fgPct: 0.600, threePct: 0.200, ftPct: 0.700, tpa: 0.3 },
  ],
  PHI: [
    { first: 'Joel', last: 'Embiid', pos: 'C', num: 21, age: 30, ht: 84, wt: 280, exp: 8, ovr: 70, archetype: 'big', ppg: 23.8, rpg: 8.2, apg: 4.5, spg: 0.9, bpg: 1.4, fgPct: 0.440, threePct: 0.300, ftPct: 0.880, tpa: 4.0 },
    { first: 'Tyrese', last: 'Maxey', pos: 'PG', num: 0, age: 24, ht: 74, wt: 200, exp: 5, ovr: 64, archetype: 'slasher', ppg: 26.3, rpg: 3.3, apg: 6.1, spg: 1.8, bpg: 0.4, fgPct: 0.440, threePct: 0.335, ftPct: 0.870, tpa: 8.0 },
    { first: 'Paul', last: 'George', pos: 'SF', num: 8, age: 34, ht: 80, wt: 220, exp: 14, ovr: 58, archetype: 'wing', ppg: 16.2, rpg: 5.3, apg: 4.3, spg: 1.8, bpg: 0.5, fgPct: 0.430, threePct: 0.355, ftPct: 0.890, tpa: 6.0 },
    { first: 'Kelly', last: 'Oubre Jr.', pos: 'SF', num: 9, age: 29, ht: 78, wt: 203, exp: 9, ovr: 48, archetype: 'slasher', ppg: 15.0, rpg: 5.0, apg: 1.5, spg: 1.2, bpg: 0.7, fgPct: 0.470, threePct: 0.320, ftPct: 0.770, tpa: 4.5 },
    { first: 'Andre', last: 'Drummond', pos: 'C', num: 5, age: 31, ht: 82, wt: 279, exp: 13, ovr: 44, archetype: 'big', ppg: 6.0, rpg: 8.0, apg: 1.0, spg: 0.9, bpg: 0.7, fgPct: 0.540, threePct: 0.000, ftPct: 0.550, tpa: 0.0 },
    { first: 'Eric', last: 'Gordon', pos: 'SG', num: 23, age: 36, ht: 75, wt: 215, exp: 16, ovr: 42, archetype: 'shooter', ppg: 7.0, rpg: 1.8, apg: 1.7, spg: 0.5, bpg: 0.2, fgPct: 0.440, threePct: 0.400, ftPct: 0.800, tpa: 4.5 },
    { first: 'Jared', last: 'McCain', pos: 'SG', num: 20, age: 20, ht: 75, wt: 200, exp: 1, ovr: 48, archetype: 'shooter', ppg: 15.3, rpg: 2.6, apg: 2.6, spg: 0.9, bpg: 0.3, fgPct: 0.460, threePct: 0.380, ftPct: 0.870, tpa: 6.0 },
    { first: 'Caleb', last: 'Martin', pos: 'SF', num: 16, age: 29, ht: 77, wt: 205, exp: 5, ovr: 44, archetype: 'two_way', ppg: 9.0, rpg: 4.5, apg: 2.0, spg: 0.7, bpg: 0.3, fgPct: 0.430, threePct: 0.350, ftPct: 0.750, tpa: 4.0 },
    { first: 'Guerschon', last: 'Yabusele', pos: 'PF', num: 28, age: 29, ht: 80, wt: 260, exp: 2, ovr: 44, archetype: 'stretch_big', ppg: 11.0, rpg: 5.6, apg: 2.5, spg: 0.7, bpg: 0.4, fgPct: 0.490, threePct: 0.380, ftPct: 0.740, tpa: 4.0 },
    { first: 'Quentin', last: 'Grimes', pos: 'SG', num: 5, age: 24, ht: 77, wt: 210, exp: 4, ovr: 46, archetype: 'shooter', ppg: 14.0, rpg: 4.5, apg: 3.3, spg: 0.9, bpg: 0.3, fgPct: 0.470, threePct: 0.375, ftPct: 0.760, tpa: 5.5 },
  ],
  TOR: [
    { first: 'Scottie', last: 'Barnes', pos: 'SF', num: 4, age: 23, ht: 79, wt: 237, exp: 4, ovr: 58, archetype: 'slasher', ppg: 19.3, rpg: 7.7, apg: 5.8, spg: 1.4, bpg: 0.9, fgPct: 0.450, threePct: 0.300, ftPct: 0.770, tpa: 4.0 },
    { first: 'RJ', last: 'Barrett', pos: 'SF', num: 9, age: 24, ht: 78, wt: 214, exp: 6, ovr: 54, archetype: 'slasher', ppg: 21.0, rpg: 6.4, apg: 5.4, spg: 0.9, bpg: 0.3, fgPct: 0.470, threePct: 0.355, ftPct: 0.720, tpa: 4.5 },
    { first: 'Immanuel', last: 'Quickley', pos: 'PG', num: 5, age: 25, ht: 75, wt: 190, exp: 5, ovr: 52, archetype: 'shooter', ppg: 17.5, rpg: 4.0, apg: 5.5, spg: 1.0, bpg: 0.3, fgPct: 0.435, threePct: 0.380, ftPct: 0.860, tpa: 6.5 },
    { first: 'Jakob', last: 'Poeltl', pos: 'C', num: 19, age: 29, ht: 84, wt: 245, exp: 8, ovr: 52, archetype: 'big', ppg: 14.5, rpg: 9.6, apg: 2.7, spg: 0.7, bpg: 1.3, fgPct: 0.630, threePct: 0.000, ftPct: 0.580, tpa: 0.0 },
    { first: 'Gradey', last: 'Dick', pos: 'SG', num: 1, age: 21, ht: 79, wt: 205, exp: 2, ovr: 48, archetype: 'shooter', ppg: 14.4, rpg: 3.5, apg: 1.9, spg: 0.7, bpg: 0.2, fgPct: 0.440, threePct: 0.360, ftPct: 0.870, tpa: 5.5 },
    { first: 'Ochai', last: 'Agbaji', pos: 'SG', num: 30, age: 24, ht: 77, wt: 215, exp: 3, ovr: 44, archetype: 'two_way', ppg: 10.0, rpg: 4.0, apg: 1.7, spg: 0.9, bpg: 0.6, fgPct: 0.480, threePct: 0.390, ftPct: 0.700, tpa: 3.5 },
    { first: 'Chris', last: 'Boucher', pos: 'PF', num: 25, age: 32, ht: 81, wt: 200, exp: 8, ovr: 42, archetype: 'stretch_big', ppg: 10.0, rpg: 5.0, apg: 0.9, spg: 0.5, bpg: 0.9, fgPct: 0.500, threePct: 0.330, ftPct: 0.760, tpa: 3.0 },
    { first: 'Jamal', last: 'Shead', pos: 'PG', num: 23, age: 22, ht: 73, wt: 200, exp: 1, ovr: 40, archetype: 'two_way', ppg: 7.5, rpg: 2.5, apg: 4.0, spg: 1.0, bpg: 0.2, fgPct: 0.400, threePct: 0.310, ftPct: 0.800, tpa: 3.0 },
    { first: 'Kelly', last: 'Olynyk', pos: 'C', num: 41, age: 33, ht: 83, wt: 240, exp: 11, ovr: 42, archetype: 'stretch_big', ppg: 8.5, rpg: 4.5, apg: 2.8, spg: 0.7, bpg: 0.3, fgPct: 0.500, threePct: 0.380, ftPct: 0.800, tpa: 2.5 },
    { first: 'Ja\'Kobe', last: 'Walter', pos: 'SG', num: 14, age: 20, ht: 77, wt: 195, exp: 1, ovr: 40, archetype: 'shooter', ppg: 8.0, rpg: 2.7, apg: 1.5, spg: 0.6, bpg: 0.2, fgPct: 0.410, threePct: 0.340, ftPct: 0.800, tpa: 4.0 },
  ],
  WAS: [
    { first: 'Jordan', last: 'Poole', pos: 'SG', num: 13, age: 25, ht: 76, wt: 194, exp: 6, ovr: 50, archetype: 'shooter', ppg: 20.5, rpg: 2.7, apg: 4.5, spg: 1.3, bpg: 0.3, fgPct: 0.440, threePct: 0.380, ftPct: 0.880, tpa: 7.5 },
    { first: 'Kyle', last: 'Kuzma', pos: 'PF', num: 33, age: 29, ht: 81, wt: 221, exp: 7, ovr: 50, archetype: 'slasher', ppg: 15.2, rpg: 5.5, apg: 2.5, spg: 0.6, bpg: 0.5, fgPct: 0.450, threePct: 0.300, ftPct: 0.720, tpa: 4.0 },
    { first: 'Jonas', last: 'Valanciunas', pos: 'C', num: 17, age: 32, ht: 83, wt: 265, exp: 12, ovr: 48, archetype: 'big', ppg: 10.4, rpg: 8.0, apg: 1.8, spg: 0.4, bpg: 0.6, fgPct: 0.560, threePct: 0.310, ftPct: 0.770, tpa: 1.0 },
    { first: 'Bilal', last: 'Coulibaly', pos: 'SG', num: 0, age: 20, ht: 79, wt: 195, exp: 2, ovr: 48, archetype: 'two_way', ppg: 12.3, rpg: 5.0, apg: 3.4, spg: 1.5, bpg: 0.9, fgPct: 0.450, threePct: 0.280, ftPct: 0.700, tpa: 3.5 },
    { first: 'Alex', last: 'Sarr', pos: 'C', num: 20, age: 19, ht: 85, wt: 224, exp: 1, ovr: 48, archetype: 'rim_protector', ppg: 13.0, rpg: 6.5, apg: 2.4, spg: 0.9, bpg: 1.5, fgPct: 0.400, threePct: 0.310, ftPct: 0.740, tpa: 3.5 },
    { first: 'Corey', last: 'Kispert', pos: 'SF', num: 24, age: 25, ht: 79, wt: 224, exp: 4, ovr: 44, archetype: 'shooter', ppg: 12.0, rpg: 2.8, apg: 1.8, spg: 0.5, bpg: 0.2, fgPct: 0.470, threePct: 0.380, ftPct: 0.850, tpa: 4.5 },
    { first: 'Bub', last: 'Carrington', pos: 'PG', num: 7, age: 19, ht: 77, wt: 195, exp: 1, ovr: 44, archetype: 'playmaker', ppg: 9.8, rpg: 4.3, apg: 4.4, spg: 0.7, bpg: 0.2, fgPct: 0.410, threePct: 0.340, ftPct: 0.820, tpa: 4.5 },
    { first: 'Kyshawn', last: 'George', pos: 'SF', num: 18, age: 21, ht: 79, wt: 209, exp: 1, ovr: 40, archetype: 'wing', ppg: 8.5, rpg: 3.5, apg: 3.0, spg: 1.0, bpg: 0.5, fgPct: 0.400, threePct: 0.320, ftPct: 0.760, tpa: 4.0 },
    { first: 'Marcus', last: 'Smart', pos: 'PG', num: 36, age: 30, ht: 76, wt: 220, exp: 10, ovr: 44, archetype: 'two_way', ppg: 9.0, rpg: 2.5, apg: 4.0, spg: 1.2, bpg: 0.2, fgPct: 0.400, threePct: 0.320, ftPct: 0.800, tpa: 4.5 },
    { first: 'Justin', last: 'Champagnie', pos: 'SF', num: 99, age: 23, ht: 78, wt: 206, exp: 3, ovr: 36, archetype: 'wing', ppg: 6.0, rpg: 4.5, apg: 1.2, spg: 0.6, bpg: 0.3, fgPct: 0.470, threePct: 0.350, ftPct: 0.700, tpa: 2.5 },
  ],
  DAL: [
    { first: 'Luka', last: 'Doncic', pos: 'PG', num: 77, age: 25, ht: 79, wt: 230, exp: 6, ovr: 74, archetype: 'playmaker', ppg: 28.1, rpg: 8.3, apg: 8.0, spg: 1.4, bpg: 0.5, fgPct: 0.470, threePct: 0.360, ftPct: 0.780, tpa: 9.0 },
    { first: 'Kyrie', last: 'Irving', pos: 'PG', num: 11, age: 32, ht: 74, wt: 195, exp: 13, ovr: 64, archetype: 'slasher', ppg: 24.0, rpg: 4.6, apg: 4.6, spg: 1.3, bpg: 0.4, fgPct: 0.475, threePct: 0.400, ftPct: 0.910, tpa: 6.5 },
    { first: 'Klay', last: 'Thompson', pos: 'SG', num: 31, age: 34, ht: 78, wt: 215, exp: 13, ovr: 52, archetype: 'shooter', ppg: 14.0, rpg: 3.4, apg: 2.0, spg: 0.7, bpg: 0.5, fgPct: 0.430, threePct: 0.390, ftPct: 0.910, tpa: 8.0 },
    { first: 'P.J.', last: 'Washington', pos: 'PF', num: 25, age: 26, ht: 79, wt: 230, exp: 5, ovr: 52, archetype: 'two_way', ppg: 14.5, rpg: 7.5, apg: 2.3, spg: 0.9, bpg: 0.9, fgPct: 0.475, threePct: 0.350, ftPct: 0.700, tpa: 4.5 },
    { first: 'Daniel', last: 'Gafford', pos: 'C', num: 21, age: 26, ht: 83, wt: 234, exp: 5, ovr: 52, archetype: 'rim_protector', ppg: 12.0, rpg: 7.0, apg: 1.5, spg: 0.6, bpg: 1.8, fgPct: 0.700, threePct: 0.000, ftPct: 0.700, tpa: 0.0 },
    { first: 'Dereck', last: 'Lively II', pos: 'C', num: 2, age: 20, ht: 85, wt: 230, exp: 2, ovr: 50, archetype: 'rim_protector', ppg: 8.7, rpg: 7.5, apg: 1.5, spg: 0.6, bpg: 1.6, fgPct: 0.730, threePct: 0.000, ftPct: 0.760, tpa: 0.0 },
    { first: 'Naji', last: 'Marshall', pos: 'SF', num: 13, age: 27, ht: 79, wt: 220, exp: 5, ovr: 46, archetype: 'two_way', ppg: 11.0, rpg: 4.5, apg: 3.5, spg: 0.9, bpg: 0.4, fgPct: 0.470, threePct: 0.380, ftPct: 0.760, tpa: 3.0 },
    { first: 'Quentin', last: 'Grimes', pos: 'SG', num: 8, age: 24, ht: 77, wt: 210, exp: 4, ovr: 44, archetype: 'shooter', ppg: 9.0, rpg: 3.0, apg: 2.0, spg: 0.8, bpg: 0.3, fgPct: 0.460, threePct: 0.380, ftPct: 0.760, tpa: 4.0 },
    { first: 'Spencer', last: 'Dinwiddie', pos: 'PG', num: 26, age: 31, ht: 77, wt: 215, exp: 10, ovr: 44, archetype: 'playmaker', ppg: 11.0, rpg: 3.0, apg: 4.4, spg: 0.7, bpg: 0.3, fgPct: 0.410, threePct: 0.330, ftPct: 0.780, tpa: 4.5 },
    { first: 'Maxi', last: 'Kleber', pos: 'PF', num: 42, age: 32, ht: 82, wt: 240, exp: 7, ovr: 40, archetype: 'stretch_big', ppg: 4.0, rpg: 3.5, apg: 1.2, spg: 0.4, bpg: 0.6, fgPct: 0.440, threePct: 0.350, ftPct: 0.750, tpa: 2.5 },
  ],
  HOU: [
    { first: 'Alperen', last: 'Sengun', pos: 'C', num: 28, age: 22, ht: 82, wt: 243, exp: 3, ovr: 60, archetype: 'big', ppg: 19.1, rpg: 10.3, apg: 4.9, spg: 1.1, bpg: 0.8, fgPct: 0.535, threePct: 0.300, ftPct: 0.690, tpa: 1.5 },
    { first: 'Jalen', last: 'Green', pos: 'SG', num: 4, age: 22, ht: 76, wt: 186, exp: 3, ovr: 56, archetype: 'slasher', ppg: 21.0, rpg: 4.8, apg: 3.4, spg: 0.9, bpg: 0.3, fgPct: 0.430, threePct: 0.350, ftPct: 0.810, tpa: 7.5 },
    { first: 'Fred', last: 'VanVleet', pos: 'PG', num: 5, age: 30, ht: 73, wt: 197, exp: 8, ovr: 54, archetype: 'two_way', ppg: 14.5, rpg: 3.8, apg: 5.6, spg: 1.6, bpg: 0.6, fgPct: 0.410, threePct: 0.350, ftPct: 0.850, tpa: 7.5 },
    { first: 'Amen', last: 'Thompson', pos: 'SF', num: 1, age: 21, ht: 79, wt: 209, exp: 2, ovr: 54, archetype: 'slasher', ppg: 14.1, rpg: 8.2, apg: 3.8, spg: 1.4, bpg: 1.3, fgPct: 0.560, threePct: 0.280, ftPct: 0.680, tpa: 1.5 },
    { first: 'Dillon', last: 'Brooks', pos: 'SF', num: 9, age: 28, ht: 79, wt: 225, exp: 7, ovr: 50, archetype: 'two_way', ppg: 14.0, rpg: 3.8, apg: 1.7, spg: 0.9, bpg: 0.4, fgPct: 0.440, threePct: 0.390, ftPct: 0.820, tpa: 5.5 },
    { first: 'Jabari', last: 'Smith Jr.', pos: 'PF', num: 10, age: 21, ht: 83, wt: 220, exp: 3, ovr: 50, archetype: 'stretch_big', ppg: 12.2, rpg: 7.0, apg: 1.5, spg: 0.7, bpg: 0.9, fgPct: 0.450, threePct: 0.360, ftPct: 0.790, tpa: 4.5 },
    { first: 'Tari', last: 'Eason', pos: 'PF', num: 17, age: 23, ht: 80, wt: 215, exp: 3, ovr: 48, archetype: 'two_way', ppg: 12.0, rpg: 6.7, apg: 1.6, spg: 1.5, bpg: 0.8, fgPct: 0.490, threePct: 0.340, ftPct: 0.730, tpa: 3.0 },
    { first: 'Steven', last: 'Adams', pos: 'C', num: 12, age: 31, ht: 83, wt: 265, exp: 11, ovr: 44, archetype: 'big', ppg: 4.0, rpg: 6.0, apg: 1.0, spg: 0.5, bpg: 0.4, fgPct: 0.580, threePct: 0.000, ftPct: 0.420, tpa: 0.0 },
    { first: 'Aaron', last: 'Holiday', pos: 'PG', num: 0, age: 28, ht: 72, wt: 185, exp: 6, ovr: 40, archetype: 'shooter', ppg: 6.5, rpg: 1.5, apg: 1.8, spg: 0.7, bpg: 0.1, fgPct: 0.440, threePct: 0.390, ftPct: 0.870, tpa: 3.0 },
    { first: 'Jae\'Sean', last: 'Tate', pos: 'SF', num: 8, age: 29, ht: 76, wt: 230, exp: 4, ovr: 38, archetype: 'two_way', ppg: 4.5, rpg: 2.5, apg: 1.5, spg: 0.6, bpg: 0.3, fgPct: 0.480, threePct: 0.300, ftPct: 0.680, tpa: 1.0 },
  ],
  LAC: [
    { first: 'James', last: 'Harden', pos: 'PG', num: 1, age: 35, ht: 77, wt: 220, exp: 15, ovr: 60, archetype: 'playmaker', ppg: 21.8, rpg: 5.8, apg: 8.7, spg: 1.5, bpg: 0.7, fgPct: 0.420, threePct: 0.355, ftPct: 0.870, tpa: 8.5 },
    { first: 'Norman', last: 'Powell', pos: 'SG', num: 24, age: 31, ht: 76, wt: 215, exp: 9, ovr: 56, archetype: 'shooter', ppg: 21.8, rpg: 3.2, apg: 2.1, spg: 1.2, bpg: 0.3, fgPct: 0.485, threePct: 0.430, ftPct: 0.840, tpa: 7.0 },
    { first: 'Ivica', last: 'Zubac', pos: 'C', num: 40, age: 27, ht: 84, wt: 240, exp: 8, ovr: 56, archetype: 'big', ppg: 16.8, rpg: 12.6, apg: 2.7, spg: 0.7, bpg: 1.1, fgPct: 0.625, threePct: 0.000, ftPct: 0.660, tpa: 0.0 },
    { first: 'Kawhi', last: 'Leonard', pos: 'SF', num: 2, age: 33, ht: 79, wt: 225, exp: 12, ovr: 62, archetype: 'two_way', ppg: 21.5, rpg: 6.1, apg: 3.5, spg: 1.6, bpg: 0.5, fgPct: 0.500, threePct: 0.410, ftPct: 0.880, tpa: 4.5 },
    { first: 'Derrick', last: 'Jones Jr.', pos: 'SF', num: 55, age: 27, ht: 78, wt: 210, exp: 7, ovr: 46, archetype: 'two_way', ppg: 10.0, rpg: 3.5, apg: 1.5, spg: 0.9, bpg: 0.7, fgPct: 0.500, threePct: 0.360, ftPct: 0.700, tpa: 3.0 },
    { first: 'Kris', last: 'Dunn', pos: 'PG', num: 8, age: 30, ht: 75, wt: 205, exp: 7, ovr: 46, archetype: 'two_way', ppg: 7.0, rpg: 3.5, apg: 4.5, spg: 1.6, bpg: 0.5, fgPct: 0.460, threePct: 0.350, ftPct: 0.730, tpa: 2.5 },
    { first: 'Nicolas', last: 'Batum', pos: 'PF', num: 33, age: 36, ht: 80, wt: 230, exp: 16, ovr: 42, archetype: 'stretch_big', ppg: 4.0, rpg: 4.0, apg: 2.0, spg: 0.9, bpg: 0.6, fgPct: 0.430, threePct: 0.380, ftPct: 0.800, tpa: 3.0 },
    { first: 'Terance', last: 'Mann', pos: 'SG', num: 14, age: 28, ht: 77, wt: 215, exp: 6, ovr: 44, archetype: 'two_way', ppg: 7.0, rpg: 3.0, apg: 2.0, spg: 0.7, bpg: 0.2, fgPct: 0.480, threePct: 0.350, ftPct: 0.780, tpa: 2.5 },
    { first: 'Amir', last: 'Coffey', pos: 'SF', num: 7, age: 27, ht: 79, wt: 210, exp: 6, ovr: 42, archetype: 'shooter', ppg: 9.0, rpg: 2.5, apg: 1.5, spg: 0.6, bpg: 0.2, fgPct: 0.460, threePct: 0.400, ftPct: 0.800, tpa: 4.0 },
    { first: 'Ben', last: 'Simmons', pos: 'PG', num: 10, age: 28, ht: 82, wt: 240, exp: 7, ovr: 42, archetype: 'playmaker', ppg: 6.0, rpg: 5.5, apg: 6.5, spg: 1.3, bpg: 0.6, fgPct: 0.560, threePct: 0.000, ftPct: 0.500, tpa: 0.2 },
  ],
  MEM: [
    { first: 'Ja', last: 'Morant', pos: 'PG', num: 12, age: 25, ht: 74, wt: 174, exp: 5, ovr: 62, archetype: 'slasher', ppg: 23.2, rpg: 4.1, apg: 7.3, spg: 1.1, bpg: 0.3, fgPct: 0.460, threePct: 0.320, ftPct: 0.810, tpa: 4.0 },
    { first: 'Jaren', last: 'Jackson Jr.', pos: 'PF', num: 13, age: 25, ht: 82, wt: 242, exp: 6, ovr: 60, archetype: 'stretch_big', ppg: 22.2, rpg: 5.6, apg: 2.0, spg: 1.2, bpg: 1.5, fgPct: 0.490, threePct: 0.360, ftPct: 0.790, tpa: 4.0 },
    { first: 'Desmond', last: 'Bane', pos: 'SG', num: 22, age: 26, ht: 77, wt: 215, exp: 4, ovr: 58, archetype: 'shooter', ppg: 19.0, rpg: 6.0, apg: 5.3, spg: 1.2, bpg: 0.4, fgPct: 0.470, threePct: 0.390, ftPct: 0.890, tpa: 6.5 },
    { first: 'Zach', last: 'Edey', pos: 'C', num: 14, age: 22, ht: 88, wt: 300, exp: 1, ovr: 48, archetype: 'rim_protector', ppg: 12.0, rpg: 9.0, apg: 1.5, spg: 0.5, bpg: 1.5, fgPct: 0.580, threePct: 0.300, ftPct: 0.640, tpa: 0.5 },
    { first: 'Marcus', last: 'Smart', pos: 'PG', num: 36, age: 30, ht: 76, wt: 220, exp: 10, ovr: 46, archetype: 'two_way', ppg: 9.0, rpg: 2.5, apg: 3.5, spg: 1.3, bpg: 0.2, fgPct: 0.400, threePct: 0.330, ftPct: 0.800, tpa: 4.5 },
    { first: 'Santi', last: 'Aldama', pos: 'PF', num: 7, age: 24, ht: 83, wt: 215, exp: 3, ovr: 48, archetype: 'stretch_big', ppg: 12.0, rpg: 6.5, apg: 2.8, spg: 0.8, bpg: 0.8, fgPct: 0.480, threePct: 0.370, ftPct: 0.750, tpa: 4.5 },
    { first: 'Scotty', last: 'Pippen Jr.', pos: 'PG', num: 1, age: 24, ht: 73, wt: 170, exp: 2, ovr: 44, archetype: 'two_way', ppg: 10.0, rpg: 3.5, apg: 5.0, spg: 1.8, bpg: 0.3, fgPct: 0.440, threePct: 0.330, ftPct: 0.800, tpa: 3.0 },
    { first: 'Jaylen', last: 'Wells', pos: 'SF', num: 0, age: 21, ht: 79, wt: 210, exp: 1, ovr: 44, archetype: 'wing', ppg: 11.0, rpg: 3.4, apg: 1.7, spg: 0.8, bpg: 0.4, fgPct: 0.430, threePct: 0.360, ftPct: 0.800, tpa: 4.5 },
    { first: 'Brandon', last: 'Clarke', pos: 'PF', num: 15, age: 28, ht: 80, wt: 215, exp: 5, ovr: 44, archetype: 'big', ppg: 8.0, rpg: 5.5, apg: 1.2, spg: 0.6, bpg: 0.6, fgPct: 0.640, threePct: 0.000, ftPct: 0.660, tpa: 0.1 },
    { first: 'Luke', last: 'Kennard', pos: 'SG', num: 18, age: 28, ht: 77, wt: 206, exp: 7, ovr: 42, archetype: 'shooter', ppg: 8.0, rpg: 2.0, apg: 2.5, spg: 0.5, bpg: 0.1, fgPct: 0.470, threePct: 0.440, ftPct: 0.900, tpa: 4.0 },
  ],
  MIN: [
    { first: 'Anthony', last: 'Edwards', pos: 'SG', num: 5, age: 23, ht: 76, wt: 225, exp: 5, ovr: 68, archetype: 'slasher', ppg: 27.6, rpg: 5.7, apg: 4.5, spg: 1.2, bpg: 0.6, fgPct: 0.450, threePct: 0.390, ftPct: 0.830, tpa: 10.5 },
    { first: 'Julius', last: 'Randle', pos: 'PF', num: 30, age: 30, ht: 80, wt: 250, exp: 10, ovr: 58, archetype: 'slasher', ppg: 19.0, rpg: 7.0, apg: 4.7, spg: 0.7, bpg: 0.3, fgPct: 0.470, threePct: 0.345, ftPct: 0.810, tpa: 5.0 },
    { first: 'Rudy', last: 'Gobert', pos: 'C', num: 27, age: 32, ht: 85, wt: 258, exp: 11, ovr: 56, archetype: 'rim_protector', ppg: 12.0, rpg: 10.9, apg: 1.6, spg: 0.7, bpg: 1.4, fgPct: 0.660, threePct: 0.000, ftPct: 0.660, tpa: 0.0 },
    { first: 'Mike', last: 'Conley', pos: 'PG', num: 10, age: 37, ht: 73, wt: 175, exp: 17, ovr: 46, archetype: 'playmaker', ppg: 8.2, rpg: 2.5, apg: 4.5, spg: 1.0, bpg: 0.1, fgPct: 0.420, threePct: 0.400, ftPct: 0.840, tpa: 4.0 },
    { first: 'Jaden', last: 'McDaniels', pos: 'SF', num: 3, age: 24, ht: 81, wt: 185, exp: 4, ovr: 52, archetype: 'two_way', ppg: 12.0, rpg: 5.5, apg: 1.8, spg: 1.1, bpg: 0.8, fgPct: 0.490, threePct: 0.350, ftPct: 0.780, tpa: 3.0 },
    { first: 'Naz', last: 'Reid', pos: 'C', num: 11, age: 25, ht: 81, wt: 264, exp: 5, ovr: 52, archetype: 'stretch_big', ppg: 14.2, rpg: 6.0, apg: 1.8, spg: 0.9, bpg: 0.9, fgPct: 0.480, threePct: 0.400, ftPct: 0.800, tpa: 5.0 },
    { first: 'Donte', last: 'DiVincenzo', pos: 'SG', num: 0, age: 27, ht: 76, wt: 203, exp: 6, ovr: 48, archetype: 'shooter', ppg: 11.5, rpg: 4.0, apg: 3.5, spg: 1.3, bpg: 0.2, fgPct: 0.420, threePct: 0.370, ftPct: 0.830, tpa: 6.5 },
    { first: 'Nickeil', last: 'Alexander-Walker', pos: 'SG', num: 9, age: 26, ht: 78, wt: 205, exp: 5, ovr: 46, archetype: 'two_way', ppg: 9.5, rpg: 2.7, apg: 2.5, spg: 1.1, bpg: 0.4, fgPct: 0.440, threePct: 0.380, ftPct: 0.850, tpa: 4.0 },
    { first: 'Josh', last: 'Minott', pos: 'PF', num: 8, age: 22, ht: 80, wt: 205, exp: 3, ovr: 36, archetype: 'wing', ppg: 4.0, rpg: 2.0, apg: 0.7, spg: 0.4, bpg: 0.4, fgPct: 0.520, threePct: 0.330, ftPct: 0.700, tpa: 1.0 },
    { first: 'Rob', last: 'Dillingham', pos: 'PG', num: 4, age: 19, ht: 73, wt: 165, exp: 1, ovr: 40, archetype: 'shooter', ppg: 7.0, rpg: 1.5, apg: 2.5, spg: 0.5, bpg: 0.1, fgPct: 0.430, threePct: 0.370, ftPct: 0.810, tpa: 3.5 },
  ],
  NOP: [
    { first: 'Zion', last: 'Williamson', pos: 'PF', num: 1, age: 24, ht: 78, wt: 284, exp: 4, ovr: 60, archetype: 'slasher', ppg: 24.6, rpg: 7.2, apg: 5.3, spg: 1.1, bpg: 0.6, fgPct: 0.570, threePct: 0.330, ftPct: 0.710, tpa: 0.8 },
    { first: 'Brandon', last: 'Ingram', pos: 'SF', num: 14, age: 27, ht: 80, wt: 190, exp: 8, ovr: 60, archetype: 'wing', ppg: 22.2, rpg: 5.6, apg: 5.2, spg: 0.9, bpg: 0.6, fgPct: 0.470, threePct: 0.370, ftPct: 0.810, tpa: 5.0 },
    { first: 'CJ', last: 'McCollum', pos: 'SG', num: 3, age: 33, ht: 75, wt: 190, exp: 11, ovr: 52, archetype: 'shooter', ppg: 21.0, rpg: 4.3, apg: 4.5, spg: 1.0, bpg: 0.5, fgPct: 0.450, threePct: 0.380, ftPct: 0.770, tpa: 7.5 },
    { first: 'Dejounte', last: 'Murray', pos: 'PG', num: 5, age: 28, ht: 76, wt: 180, exp: 7, ovr: 56, archetype: 'two_way', ppg: 18.0, rpg: 6.0, apg: 7.5, spg: 1.5, bpg: 0.3, fgPct: 0.450, threePct: 0.350, ftPct: 0.790, tpa: 6.5 },
    { first: 'Herbert', last: 'Jones', pos: 'SF', num: 5, age: 26, ht: 79, wt: 206, exp: 4, ovr: 50, archetype: 'two_way', ppg: 11.0, rpg: 3.7, apg: 2.6, spg: 1.5, bpg: 0.8, fgPct: 0.490, threePct: 0.400, ftPct: 0.800, tpa: 3.5 },
    { first: 'Trey', last: 'Murphy III', pos: 'SF', num: 25, age: 24, ht: 81, wt: 206, exp: 4, ovr: 54, archetype: 'shooter', ppg: 18.5, rpg: 5.0, apg: 3.5, spg: 1.1, bpg: 0.5, fgPct: 0.470, threePct: 0.380, ftPct: 0.840, tpa: 7.0 },
    { first: 'Jose', last: 'Alvarado', pos: 'PG', num: 15, age: 26, ht: 72, wt: 179, exp: 4, ovr: 44, archetype: 'two_way', ppg: 9.0, rpg: 2.3, apg: 3.3, spg: 1.5, bpg: 0.2, fgPct: 0.430, threePct: 0.350, ftPct: 0.800, tpa: 3.0 },
    { first: 'Yves', last: 'Missi', pos: 'C', num: 21, age: 20, ht: 83, wt: 240, exp: 1, ovr: 44, archetype: 'rim_protector', ppg: 9.0, rpg: 8.0, apg: 1.0, spg: 0.5, bpg: 1.3, fgPct: 0.600, threePct: 0.000, ftPct: 0.620, tpa: 0.1 },
    { first: 'Jordan', last: 'Hawkins', pos: 'SG', num: 24, age: 22, ht: 77, wt: 195, exp: 2, ovr: 42, archetype: 'shooter', ppg: 9.5, rpg: 2.5, apg: 1.5, spg: 0.5, bpg: 0.2, fgPct: 0.410, threePct: 0.360, ftPct: 0.800, tpa: 6.0 },
    { first: 'Kelly', last: 'Olynyk', pos: 'C', num: 41, age: 33, ht: 83, wt: 240, exp: 11, ovr: 42, archetype: 'stretch_big', ppg: 9.0, rpg: 4.5, apg: 3.0, spg: 0.7, bpg: 0.3, fgPct: 0.500, threePct: 0.380, ftPct: 0.800, tpa: 2.5 },
  ],
  PHX: [
    { first: 'Kevin', last: 'Durant', pos: 'SF', num: 35, age: 36, ht: 83, wt: 240, exp: 16, ovr: 66, archetype: 'wing', ppg: 26.6, rpg: 6.0, apg: 4.2, spg: 0.8, bpg: 1.2, fgPct: 0.520, threePct: 0.430, ftPct: 0.840, tpa: 5.5 },
    { first: 'Devin', last: 'Booker', pos: 'SG', num: 1, age: 28, ht: 77, wt: 206, exp: 9, ovr: 66, archetype: 'shooter', ppg: 25.6, rpg: 4.1, apg: 7.1, spg: 0.9, bpg: 0.3, fgPct: 0.460, threePct: 0.370, ftPct: 0.880, tpa: 6.5 },
    { first: 'Bradley', last: 'Beal', pos: 'SG', num: 3, age: 31, ht: 76, wt: 207, exp: 12, ovr: 56, archetype: 'slasher', ppg: 17.0, rpg: 4.0, apg: 4.0, spg: 1.0, bpg: 0.5, fgPct: 0.500, threePct: 0.400, ftPct: 0.800, tpa: 5.0 },
    { first: 'Jusuf', last: 'Nurkic', pos: 'C', num: 20, age: 30, ht: 84, wt: 290, exp: 10, ovr: 48, archetype: 'big', ppg: 9.0, rpg: 9.5, apg: 3.0, spg: 0.9, bpg: 0.9, fgPct: 0.480, threePct: 0.300, ftPct: 0.700, tpa: 1.0 },
    { first: 'Tyus', last: 'Jones', pos: 'PG', num: 21, age: 28, ht: 73, wt: 196, exp: 9, ovr: 48, archetype: 'playmaker', ppg: 10.0, rpg: 2.5, apg: 5.5, spg: 1.0, bpg: 0.1, fgPct: 0.470, threePct: 0.410, ftPct: 0.820, tpa: 4.0 },
    { first: 'Grayson', last: 'Allen', pos: 'SG', num: 8, age: 29, ht: 76, wt: 198, exp: 7, ovr: 48, archetype: 'shooter', ppg: 11.0, rpg: 3.5, apg: 3.0, spg: 0.9, bpg: 0.2, fgPct: 0.490, threePct: 0.440, ftPct: 0.870, tpa: 6.0 },
    { first: 'Royce', last: 'O\'Neale', pos: 'PF', num: 0, age: 31, ht: 78, wt: 226, exp: 7, ovr: 44, archetype: 'two_way', ppg: 8.0, rpg: 5.0, apg: 2.5, spg: 0.9, bpg: 0.5, fgPct: 0.440, threePct: 0.380, ftPct: 0.780, tpa: 5.0 },
    { first: 'Mason', last: 'Plumlee', pos: 'C', num: 24, age: 34, ht: 83, wt: 254, exp: 11, ovr: 40, archetype: 'big', ppg: 5.0, rpg: 6.0, apg: 2.5, spg: 0.6, bpg: 0.6, fgPct: 0.580, threePct: 0.000, ftPct: 0.600, tpa: 0.1 },
    { first: 'Ryan', last: 'Dunn', pos: 'SF', num: 0, age: 21, ht: 79, wt: 216, exp: 1, ovr: 40, archetype: 'two_way', ppg: 6.0, rpg: 3.5, apg: 0.8, spg: 0.7, bpg: 1.0, fgPct: 0.450, threePct: 0.340, ftPct: 0.700, tpa: 2.5 },
    { first: 'Bol', last: 'Bol', pos: 'C', num: 11, age: 25, ht: 86, wt: 220, exp: 5, ovr: 38, archetype: 'stretch_big', ppg: 5.5, rpg: 3.5, apg: 0.6, spg: 0.4, bpg: 1.0, fgPct: 0.560, threePct: 0.330, ftPct: 0.700, tpa: 1.5 },
  ],
  POR: [
    { first: 'Anfernee', last: 'Simons', pos: 'SG', num: 1, age: 25, ht: 75, wt: 181, exp: 6, ovr: 54, archetype: 'shooter', ppg: 19.3, rpg: 2.6, apg: 4.8, spg: 0.9, bpg: 0.2, fgPct: 0.430, threePct: 0.365, ftPct: 0.900, tpa: 8.5 },
    { first: 'Deni', last: 'Avdija', pos: 'SF', num: 8, age: 24, ht: 81, wt: 210, exp: 4, ovr: 52, archetype: 'slasher', ppg: 13.5, rpg: 7.0, apg: 3.8, spg: 0.9, bpg: 0.5, fgPct: 0.470, threePct: 0.350, ftPct: 0.760, tpa: 4.0 },
    { first: 'Jerami', last: 'Grant', pos: 'PF', num: 9, age: 30, ht: 80, wt: 210, exp: 10, ovr: 50, archetype: 'wing', ppg: 14.4, rpg: 3.5, apg: 2.5, spg: 0.7, bpg: 0.8, fgPct: 0.420, threePct: 0.370, ftPct: 0.810, tpa: 5.5 },
    { first: 'Shaedon', last: 'Sharpe', pos: 'SG', num: 17, age: 21, ht: 78, wt: 200, exp: 3, ovr: 50, archetype: 'slasher', ppg: 17.5, rpg: 4.5, apg: 2.7, spg: 0.9, bpg: 0.4, fgPct: 0.460, threePct: 0.330, ftPct: 0.810, tpa: 4.5 },
    { first: 'Deandre', last: 'Ayton', pos: 'C', num: 2, age: 26, ht: 84, wt: 252, exp: 6, ovr: 52, archetype: 'big', ppg: 14.4, rpg: 10.2, apg: 1.7, spg: 0.8, bpg: 0.8, fgPct: 0.560, threePct: 0.200, ftPct: 0.770, tpa: 0.3 },
    { first: 'Toumani', last: 'Camara', pos: 'PF', num: 33, age: 24, ht: 79, wt: 220, exp: 2, ovr: 46, archetype: 'two_way', ppg: 11.0, rpg: 5.8, apg: 2.0, spg: 1.3, bpg: 0.6, fgPct: 0.470, threePct: 0.370, ftPct: 0.750, tpa: 4.0 },
    { first: 'Scoot', last: 'Henderson', pos: 'PG', num: 0, age: 20, ht: 75, wt: 195, exp: 2, ovr: 46, archetype: 'slasher', ppg: 13.0, rpg: 3.3, apg: 5.4, spg: 0.9, bpg: 0.3, fgPct: 0.420, threePct: 0.330, ftPct: 0.820, tpa: 4.5 },
    { first: 'Robert', last: 'Williams III', pos: 'C', num: 35, age: 27, ht: 81, wt: 237, exp: 6, ovr: 44, archetype: 'rim_protector', ppg: 6.0, rpg: 6.0, apg: 1.5, spg: 0.7, bpg: 1.5, fgPct: 0.700, threePct: 0.000, ftPct: 0.600, tpa: 0.0 },
    { first: 'Jabari', last: 'Walker', pos: 'PF', num: 34, age: 22, ht: 80, wt: 215, exp: 3, ovr: 40, archetype: 'big', ppg: 6.0, rpg: 5.5, apg: 1.0, spg: 0.6, bpg: 0.3, fgPct: 0.480, threePct: 0.330, ftPct: 0.760, tpa: 1.5 },
    { first: 'Donovan', last: 'Clingan', pos: 'C', num: 23, age: 20, ht: 86, wt: 280, exp: 1, ovr: 46, archetype: 'rim_protector', ppg: 7.0, rpg: 7.5, apg: 1.5, spg: 0.6, bpg: 1.6, fgPct: 0.560, threePct: 0.000, ftPct: 0.600, tpa: 0.1 },
  ],
  SAC: [
    { first: 'De\'Aaron', last: 'Fox', pos: 'PG', num: 5, age: 27, ht: 75, wt: 185, exp: 8, ovr: 64, archetype: 'slasher', ppg: 25.6, rpg: 4.5, apg: 6.1, spg: 1.6, bpg: 0.3, fgPct: 0.470, threePct: 0.340, ftPct: 0.840, tpa: 6.5 },
    { first: 'Domantas', last: 'Sabonis', pos: 'C', num: 11, age: 28, ht: 83, wt: 240, exp: 8, ovr: 64, archetype: 'big', ppg: 19.1, rpg: 13.9, apg: 6.0, spg: 0.7, bpg: 0.5, fgPct: 0.600, threePct: 0.420, ftPct: 0.750, tpa: 1.5 },
    { first: 'DeMar', last: 'DeRozan', pos: 'SF', num: 10, age: 35, ht: 78, wt: 220, exp: 15, ovr: 56, archetype: 'slasher', ppg: 22.2, rpg: 3.9, apg: 4.4, spg: 0.9, bpg: 0.4, fgPct: 0.480, threePct: 0.330, ftPct: 0.860, tpa: 2.0 },
    { first: 'Malik', last: 'Monk', pos: 'SG', num: 0, age: 26, ht: 75, wt: 200, exp: 7, ovr: 52, archetype: 'shooter', ppg: 17.2, rpg: 3.5, apg: 5.5, spg: 0.8, bpg: 0.3, fgPct: 0.440, threePct: 0.330, ftPct: 0.850, tpa: 6.0 },
    { first: 'Keegan', last: 'Murray', pos: 'PF', num: 13, age: 24, ht: 80, wt: 215, exp: 3, ovr: 52, archetype: 'two_way', ppg: 12.4, rpg: 6.7, apg: 1.5, spg: 1.1, bpg: 0.9, fgPct: 0.450, threePct: 0.350, ftPct: 0.840, tpa: 5.5 },
    { first: 'Keon', last: 'Ellis', pos: 'SG', num: 23, age: 25, ht: 75, wt: 175, exp: 3, ovr: 46, archetype: 'two_way', ppg: 9.0, rpg: 3.0, apg: 1.8, spg: 1.5, bpg: 0.6, fgPct: 0.480, threePct: 0.410, ftPct: 0.820, tpa: 3.5 },
    { first: 'Trey', last: 'Lyles', pos: 'PF', num: 41, age: 29, ht: 81, wt: 234, exp: 9, ovr: 42, archetype: 'stretch_big', ppg: 7.0, rpg: 4.5, apg: 1.5, spg: 0.6, bpg: 0.4, fgPct: 0.450, threePct: 0.350, ftPct: 0.770, tpa: 3.0 },
    { first: 'Jonas', last: 'Valanciunas', pos: 'C', num: 17, age: 32, ht: 83, wt: 265, exp: 12, ovr: 46, archetype: 'big', ppg: 9.0, rpg: 7.0, apg: 1.5, spg: 0.4, bpg: 0.5, fgPct: 0.560, threePct: 0.300, ftPct: 0.780, tpa: 0.8 },
    { first: 'Devin', last: 'Carter', pos: 'PG', num: 22, age: 22, ht: 75, wt: 195, exp: 1, ovr: 40, archetype: 'two_way', ppg: 6.0, rpg: 3.5, apg: 2.0, spg: 0.9, bpg: 0.3, fgPct: 0.410, threePct: 0.320, ftPct: 0.760, tpa: 3.0 },
    { first: 'Doug', last: 'McDermott', pos: 'SF', num: 3, age: 33, ht: 79, wt: 225, exp: 10, ovr: 38, archetype: 'shooter', ppg: 6.0, rpg: 1.5, apg: 1.0, spg: 0.3, bpg: 0.1, fgPct: 0.460, threePct: 0.410, ftPct: 0.850, tpa: 3.5 },
  ],
  SAS: [
    { first: 'Victor', last: 'Wembanyama', pos: 'C', num: 1, age: 21, ht: 88, wt: 235, exp: 2, ovr: 70, archetype: 'rim_protector', ppg: 24.3, rpg: 11.0, apg: 3.7, spg: 1.1, bpg: 3.8, fgPct: 0.470, threePct: 0.350, ftPct: 0.840, tpa: 6.0 },
    { first: 'De\'Aaron', last: 'Fox', pos: 'PG', num: 4, age: 27, ht: 75, wt: 185, exp: 8, ovr: 62, archetype: 'slasher', ppg: 24.0, rpg: 4.5, apg: 6.5, spg: 1.6, bpg: 0.3, fgPct: 0.460, threePct: 0.330, ftPct: 0.840, tpa: 6.0 },
    { first: 'Devin', last: 'Vassell', pos: 'SG', num: 24, age: 24, ht: 78, wt: 200, exp: 4, ovr: 54, archetype: 'shooter', ppg: 16.5, rpg: 3.8, apg: 2.8, spg: 1.0, bpg: 0.3, fgPct: 0.440, threePct: 0.370, ftPct: 0.830, tpa: 6.0 },
    { first: 'Stephon', last: 'Castle', pos: 'PG', num: 5, age: 20, ht: 78, wt: 215, exp: 1, ovr: 50, archetype: 'slasher', ppg: 14.7, rpg: 3.7, apg: 4.1, spg: 0.9, bpg: 0.4, fgPct: 0.430, threePct: 0.290, ftPct: 0.720, tpa: 3.5 },
    { first: 'Harrison', last: 'Barnes', pos: 'SF', num: 40, age: 32, ht: 80, wt: 225, exp: 12, ovr: 48, archetype: 'wing', ppg: 12.3, rpg: 3.9, apg: 1.5, spg: 0.6, bpg: 0.2, fgPct: 0.470, threePct: 0.390, ftPct: 0.820, tpa: 4.5 },
    { first: 'Keldon', last: 'Johnson', pos: 'SF', num: 3, age: 25, ht: 77, wt: 220, exp: 5, ovr: 48, archetype: 'slasher', ppg: 13.0, rpg: 5.0, apg: 2.5, spg: 0.7, bpg: 0.2, fgPct: 0.460, threePct: 0.350, ftPct: 0.780, tpa: 4.0 },
    { first: 'Jeremy', last: 'Sochan', pos: 'PF', num: 10, age: 21, ht: 80, wt: 230, exp: 3, ovr: 48, archetype: 'two_way', ppg: 11.0, rpg: 6.5, apg: 2.5, spg: 0.9, bpg: 0.7, fgPct: 0.480, threePct: 0.320, ftPct: 0.700, tpa: 2.0 },
    { first: 'Chris', last: 'Paul', pos: 'PG', num: 3, age: 39, ht: 73, wt: 175, exp: 19, ovr: 48, archetype: 'playmaker', ppg: 9.0, rpg: 3.6, apg: 8.0, spg: 1.3, bpg: 0.1, fgPct: 0.440, threePct: 0.370, ftPct: 0.900, tpa: 4.0 },
    { first: 'Julian', last: 'Champagnie', pos: 'SF', num: 30, age: 23, ht: 80, wt: 220, exp: 3, ovr: 42, archetype: 'shooter', ppg: 9.0, rpg: 4.0, apg: 1.5, spg: 0.7, bpg: 0.5, fgPct: 0.430, threePct: 0.380, ftPct: 0.780, tpa: 5.0 },
    { first: 'Zach', last: 'Collins', pos: 'C', num: 23, age: 27, ht: 83, wt: 250, exp: 6, ovr: 42, archetype: 'big', ppg: 9.0, rpg: 5.5, apg: 2.5, spg: 0.5, bpg: 0.6, fgPct: 0.490, threePct: 0.350, ftPct: 0.770, tpa: 1.5 },
  ],
  UTA: [
    { first: 'Lauri', last: 'Markkanen', pos: 'PF', num: 23, age: 27, ht: 84, wt: 240, exp: 7, ovr: 58, archetype: 'stretch_big', ppg: 19.0, rpg: 5.9, apg: 1.5, spg: 0.9, bpg: 0.5, fgPct: 0.430, threePct: 0.350, ftPct: 0.880, tpa: 7.0 },
    { first: 'Collin', last: 'Sexton', pos: 'PG', num: 2, age: 25, ht: 73, wt: 190, exp: 6, ovr: 52, archetype: 'slasher', ppg: 18.4, rpg: 2.8, apg: 4.2, spg: 0.9, bpg: 0.2, fgPct: 0.480, threePct: 0.400, ftPct: 0.860, tpa: 4.5 },
    { first: 'Walker', last: 'Kessler', pos: 'C', num: 24, age: 23, ht: 84, wt: 245, exp: 3, ovr: 52, archetype: 'rim_protector', ppg: 11.1, rpg: 12.2, apg: 1.7, spg: 0.6, bpg: 2.4, fgPct: 0.660, threePct: 0.000, ftPct: 0.520, tpa: 0.0 },
    { first: 'John', last: 'Collins', pos: 'PF', num: 20, age: 27, ht: 81, wt: 226, exp: 7, ovr: 50, archetype: 'big', ppg: 18.5, rpg: 8.5, apg: 1.6, spg: 0.7, bpg: 1.0, fgPct: 0.530, threePct: 0.400, ftPct: 0.810, tpa: 3.0 },
    { first: 'Jordan', last: 'Clarkson', pos: 'SG', num: 0, age: 32, ht: 75, wt: 194, exp: 10, ovr: 46, archetype: 'shooter', ppg: 16.0, rpg: 3.3, apg: 3.7, spg: 0.8, bpg: 0.2, fgPct: 0.410, threePct: 0.330, ftPct: 0.810, tpa: 6.0 },
    { first: 'Keyonte', last: 'George', pos: 'PG', num: 3, age: 21, ht: 76, wt: 185, exp: 2, ovr: 48, archetype: 'shooter', ppg: 16.8, rpg: 3.6, apg: 5.3, spg: 0.9, bpg: 0.2, fgPct: 0.400, threePct: 0.350, ftPct: 0.870, tpa: 7.0 },
    { first: 'Isaiah', last: 'Collier', pos: 'PG', num: 13, age: 20, ht: 75, wt: 205, exp: 1, ovr: 44, archetype: 'playmaker', ppg: 8.0, rpg: 3.0, apg: 6.3, spg: 1.0, bpg: 0.2, fgPct: 0.450, threePct: 0.270, ftPct: 0.700, tpa: 2.0 },
    { first: 'Brice', last: 'Sensabaugh', pos: 'SF', num: 21, age: 21, ht: 78, wt: 235, exp: 2, ovr: 42, archetype: 'shooter', ppg: 10.0, rpg: 3.0, apg: 1.5, spg: 0.5, bpg: 0.2, fgPct: 0.440, threePct: 0.390, ftPct: 0.840, tpa: 5.0 },
    { first: 'Taylor', last: 'Hendricks', pos: 'PF', num: 0, age: 21, ht: 81, wt: 210, exp: 2, ovr: 40, archetype: 'stretch_big', ppg: 7.0, rpg: 4.5, apg: 0.8, spg: 0.6, bpg: 0.8, fgPct: 0.440, threePct: 0.350, ftPct: 0.730, tpa: 3.5 },
    { first: 'Cody', last: 'Williams', pos: 'SF', num: 5, age: 20, ht: 80, wt: 190, exp: 1, ovr: 36, archetype: 'wing', ppg: 5.0, rpg: 2.5, apg: 1.5, spg: 0.6, bpg: 0.3, fgPct: 0.380, threePct: 0.300, ftPct: 0.700, tpa: 2.5 },
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

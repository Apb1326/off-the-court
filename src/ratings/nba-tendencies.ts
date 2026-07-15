/** S2c1 candidate-only real-data tendency derivation. Pure, deterministic, and inactive. */
import { PlayerTendencies, Position } from '../models/player';
import { BoxAdvancedRow, PlayTypeRow, ShotEventRow, ShotZonesRow } from '../data/nba/types';
import { classifyShot } from '../data/nba/shot-classification';
import {
  FULL_CONFIDENCE_SAMPLE,
  NbaDerivationOptions,
  PRODUCTION_NBA_DERIVATION_OPTIONS,
  seasonRelativeNbaDerivationOptions,
} from './nba-derivation';

export const TENDENCY_MIN_SYNERGY_POSS = 100; // avoids treating sparse single-play samples as a player diet
export const TENDENCY_MIN_SHOT_FGA = 100; // post-heave attempts required before individual shot mix is trusted
export const TENDENCY_USAGE_MIN = 0.10; // matches the legacy engine-consumable usage clamp
export const TENDENCY_USAGE_MAX = 0.40;
const FIELDS = ['isolationFreq','pickAndRollBallHandlerFreq','pickAndRollScreenerFreq','postUpFreq','spotUpFreq','transitionFreq','cutFreq','offScreenFreq','handoffFreq'] as const;
type FreqField = typeof FIELDS[number];
const MAP: Record<string, FreqField> = { Isolation:'isolationFreq', PRBallHandler:'pickAndRollBallHandlerFreq', PRRollMan:'pickAndRollScreenerFreq', Postup:'postUpFreq', Spotup:'spotUpFreq', Transition:'transitionFreq', Cut:'cutFreq', OffScreen:'offScreenFreq', Handoff:'handoffFreq' };
export interface TendencyInput { personId:number; id:string; position:Position; boxSeasons: readonly {season:string;row:BoxAdvancedRow}[]; shotZoneSeasons?: readonly {season:string;row:ShotZonesRow}[]; raw: { gamesPlayed:number; minutesPerGame:number; stats:{fieldGoalsAttempted:number;freeThrowsAttempted:number;assists:number;rebounds:number} } }
export interface TendencyResult { tendencies:Map<number,PlayerTendencies>; fallbackLog:{playerId:string;field:string;reason:string}[]; coveredSynergy:number; coveredShots:number; coveredUsage:number; synergyPossessions:Map<number,number>; shotFga:Map<number,number>; shotMixSource:Map<number,'shot_events'|'shot_zones'|'position_fallback'>; }
const empty = (): Record<FreqField,number> => Object.fromEntries(FIELDS.map(k=>[k,0])) as Record<FreqField,number>;
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
function zoneMix(row: ShotZonesRow): { mix: [number,number,number]; fga: number } {
 const rim = row.otcZones.rim;
 const mid = { fgm: row.otcZones.short_midrange.fgm + row.otcZones.long_midrange.fgm, fga: row.otcZones.short_midrange.fga + row.otcZones.long_midrange.fga };
 const backcourt = row.nbaZones.Backcourt ?? { fgm: 0, fga: 0 };
 const three = { fgm: row.otcZones.corner_three.fgm + row.otcZones.above_break_three.fgm - backcourt.fgm, fga: row.otcZones.corner_three.fga + row.otcZones.above_break_three.fga - backcourt.fga };
 const fga = rim.fga + mid.fga + three.fga;
 return { mix: fga > 0 ? [rim.fga / fga, mid.fga / fga, three.fga / fga] : [0, 0, 0], fga };
}
export function deriveNbaTendencies(
 input: readonly TendencyInput[],
 playtypes: readonly PlayTypeRow[],
 shots: readonly ShotEventRow[],
 options: NbaDerivationOptions & { targetSeason?: string } = { ...PRODUCTION_NBA_DERIVATION_OPTIONS },
): TendencyResult {
 const pBy=new Map<number,PlayTypeRow[]>(); for(const r of playtypes) if(r.typeGrouping==='offensive'){const a=pBy.get(r.personId)??[];a.push(r);pBy.set(r.personId,a)}
 const sBy=new Map<number,ShotEventRow[]>(); for(const r of shots){const a=sBy.get(r.playerId)??[];a.push(r);sBy.set(r.playerId,a)}
 const rescueShotMix = options.targetSeason !== undefined && shots.length === 0;
 const freq=new Map<number,Record<FreqField,number>>(), mix=new Map<number,[number,number,number]>();
 const synergyPossessions=new Map<number,number>(), shotFga=new Map<number,number>();
 const groupFreq=new Map<Position,{v:Record<FreqField,number>;n:number}>(), groupMix=new Map<Position,{v:[number,number,number];n:number}>();
 for(const p of input){const f=empty();let n=0; for(const r of pBy.get(p.personId)??[]){const k=MAP[r.playType];if(k&&finite(r.poss)&&r.poss>0){f[k]+=r.poss;n+=r.poss}} if(n>=TENDENCY_MIN_SYNERGY_POSS){for(const k of FIELDS)f[k]/=n;freq.set(p.personId,f);const g=groupFreq.get(p.position)??{v:empty(),n:0};for(const k of FIELDS)g.v[k]+=f[k]*n;g.n+=n;groupFreq.set(p.position,g)}
  const m:[number,number,number]=[0,0,0];for(const r of sBy.get(p.personId)??[]){const z=classifyShot(r);if(z==='heave')continue;if(z==='rim')m[0]++;else if(z==='short_midrange'||z==='long_midrange')m[1]++;else m[2]++}const mn=m[0]+m[1]+m[2];if(mn>=TENDENCY_MIN_SHOT_FGA){m[0]/=mn;m[1]/=mn;m[2]/=mn;mix.set(p.personId,m);const g=groupMix.get(p.position)??{v:[0,0,0],n:0};g.v[0]+=m[0]*mn;g.v[1]+=m[1]*mn;g.v[2]+=m[2]*mn;g.n+=mn;groupMix.set(p.position,g)} else if(rescueShotMix){const row=p.shotZoneSeasons?.find((entry)=>entry.season===options.targetSeason)?.row; if(row){const rescued=zoneMix(row);if(rescued.fga>=TENDENCY_MIN_SHOT_FGA){mix.set(p.personId,rescued.mix);const g=groupMix.get(p.position)??{v:[0,0,0],n:0};g.v[0]+=rescued.mix[0]*rescued.fga;g.v[1]+=rescued.mix[1]*rescued.fga;g.v[2]+=rescued.mix[2]*rescued.fga;g.n+=rescued.fga;groupMix.set(p.position,g)}}} }
 for(const p of input){const f=freq.get(p.personId);if(f) synergyPossessions.set(p.personId,(pBy.get(p.personId)??[]).filter(r=>MAP[r.playType]&&finite(r.poss)&&r.poss>0).reduce((sum,r)=>sum+r.poss!,0));const m=mix.get(p.personId);if(m) shotFga.set(p.personId,(sBy.get(p.personId)??[]).reduce((sum,r)=>sum+(classifyShot(r)==='heave'?0:1),0))}
 for(const g of groupFreq.values())for(const k of FIELDS)g.v[k]/=g.n; for(const g of groupMix.values())for(let i=0;i<3;i++)g.v[i]/=g.n;
 const tendencies=new Map<number,PlayerTendencies>(), fallbackLog:TendencyResult['fallbackLog']=[],shotMixSource=new Map<number,'shot_events'|'shot_zones'|'position_fallback'>();let coveredSynergy=0,coveredShots=0,coveredUsage=0;
 for(const p of input){let f=freq.get(p.personId);if(!f){f=groupFreq.get(p.position)?.v??Object.fromEntries(FIELDS.map(k=>[k,1/FIELDS.length])) as Record<FreqField,number>;fallbackLog.push({playerId:p.id,field:'play-type frequencies',reason:`below ${TENDENCY_MIN_SYNERGY_POSS} mapped Synergy possessions; position fallback`})}else coveredSynergy++;let m=mix.get(p.personId);if(!m){m=groupMix.get(p.position)?.v??[.3,.3,.4];shotMixSource.set(p.personId,'position_fallback');fallbackLog.push({playerId:p.id,field:'shot mix',reason:`below ${TENDENCY_MIN_SHOT_FGA} ${rescueShotMix ? 'shot-events FGA; shot-zones rescue unavailable' : 'post-heave FGA'}; position fallback`})}else{shotMixSource.set(p.personId,rescueShotMix ? 'shot_zones' : 'shot_events');coveredShots++}
  let num=0,den=0;for(const x of p.boxSeasons){const w=options.recentSeasonWeights[x.season];const u=x.row.advanced?.usgPct, poss=x.row.advanced?.poss;if(w!==undefined&&finite(u)&&finite(poss)&&poss>0){num+=u*poss*w;den+=poss*w}}let usage; if(den>=FULL_CONFIDENCE_SAMPLE){usage=Math.max(TENDENCY_USAGE_MIN,Math.min(TENDENCY_USAGE_MAX,num/den));coveredUsage++}else{usage=Math.max(TENDENCY_USAGE_MIN,Math.min(TENDENCY_USAGE_MAX,(p.raw.stats.fieldGoalsAttempted+p.raw.stats.freeThrowsAttempted*.44+p.raw.stats.assists*.33)/Math.max(1,p.raw.minutesPerGame*2.08)));fallbackLog.push({playerId:p.id,field:'usageRate',reason:`recent box_advanced sample ${den.toFixed(1)} below S2b validity gate ${FULL_CONFIDENCE_SAMPLE}; legacy estimate`})}
  const s=p.raw.stats, fga=Math.max(1,s.fieldGoalsAttempted); tendencies.set(p.personId,{...f, rimRate:m[0],midrangeRate:m[1],threePointRate:m[2], drawFoulRate:s.freeThrowsAttempted/Math.max(1,fga*2)*.5,assistRate:s.assists/Math.max(1,p.raw.minutesPerGame)*5,usageRate:usage,reboundRate:s.rebounds/Math.max(1,p.raw.minutesPerGame)*2.5}); }
 return {tendencies,fallbackLog:fallbackLog.sort((a,b)=>a.playerId.localeCompare(b.playerId)||a.field.localeCompare(b.field)),coveredSynergy,coveredShots,coveredUsage,synergyPossessions,shotFga,shotMixSource};
}

import type { Network, NetworkState } from './data';
export type HeatBalanceRow = { phase: string; storedRise: number; reconstructedRise: number; residual: number; withinTolerance: boolean };
export type HeatAudit = { status: 'consistent' | 'inconsistent' | 'missing'; reciprocal: boolean; passive: boolean; rows: HeatBalanceRow[]; maximumResidual: number | null };

/** An arithmetic audit of saved G and Q, not a new ampacity or transient solver. */
export function auditNetwork(network: Network, state: NetworkState | null): HeatAudit {
  const g=network.mutual;
  const scale=Math.max(...g.flat().map(Math.abs));
  const tolerance=Math.max(1e-12,scale*1e-8);
  const reciprocal=g.every((row,i)=>row.every((n,j)=>Math.abs(n-g[j][i])<=tolerance));
  const l=Array.from({length:3},()=>[0,0,0]);
  let passive=reciprocal;
  // Cholesky tests the symmetric, stored influence relation; no inverse or fit is used.
  for(let i=0;i<3&&passive;i++) for(let j=0;j<=i;j++) {
    let v=(g[i][j]+g[j][i])/2;
    for(let k=0;k<j;k++) v-=l[i][k]*l[j][k];
    if(i===j){if(v<=Math.max(1e-14,scale*1e-12)){passive=false;break;}l[i][j]=Math.sqrt(v);}
    else l[i][j]=v/l[j][j];
  }
  if(!state) return {status:'missing',reciprocal,passive,rows:[],maximumResidual:null};
  const rows=['A','B','C'].map((phase,i)=>{
    const profile=state.profiles.find(p=>p.phase===phase);
    if(!profile||!profile.temperatures.length)throw new Error('审计所需相别温度缺失。');
    const storedRise=profile.temperatures[profile.temperatures.length-1]-network.ambient;
    const reconstructedRise=g[i].reduce((sum,n,j)=>sum+n*state.losses[j],0);
    const residual=storedRise-reconstructedRise;
    return {phase,storedRise,reconstructedRise,residual,withinTolerance:Math.abs(residual)<=1e-5+1e-6*Math.max(Math.abs(storedRise),Math.abs(reconstructedRise))};
  });
  return {status:reciprocal&&passive&&rows.every(r=>r.withinTolerance)?'consistent':'inconsistent',reciprocal,passive,rows,maximumResidual:Math.max(...rows.map(r=>Math.abs(r.residual)))};
}

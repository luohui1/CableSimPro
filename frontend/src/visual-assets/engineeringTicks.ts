/** View-only meter ticks. Neither geometry, snapping nor model units are changed. */
export function meterStep(minimum:number):number {
 if(!Number.isFinite(minimum)||minimum<=0)return 1;
 const power=10**Math.floor(Math.log10(minimum)),fraction=minimum/power;
 return (fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*power;
}
export function meterTicks(origin:number,scale:number,start:number,end:number,step:number):number[]{
 if(![origin,scale,start,end,step].every(Number.isFinite)||scale<=0||step<=0||end<=start)return [];
 const first=Math.ceil((start-origin)/scale/step),last=Math.floor((end-origin)/scale/step);
 // A malformed or extreme view must not allocate unbounded scene objects.
 if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||last-first>200)return [];
 return Array.from({length:Math.max(0,last-first+1)},(_,i)=>(first+i)*step);
}
export function rulerSteps(scale:number):{major:number;minor:number}{
 const major=meterStep(56/scale);
 return {major,minor:major/5*scale>=14?major/5:major/2};
}
export function meterLabel(value:number,step:number):string{
 const digits=Math.min(6,Math.max(0,-Math.floor(Math.log10(step))));
 return (Math.abs(value)<step/100?0:value).toFixed(digits);
}

import type {Installation} from './types';
export function positions(e:Installation):number[][] {
 const s=e.spacing_m,h=e.depth_m;
 return e.arrangement==='flat'?[[-s,h],[0,h],[s,h]]:[[0,h-s/Math.sqrt(3)],[-s/2,h+s/(2*Math.sqrt(3))],[s/2,h+s/(2*Math.sqrt(3))]];
}

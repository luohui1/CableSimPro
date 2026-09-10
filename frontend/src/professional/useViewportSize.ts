import {useEffect,useState} from 'react';
export function useViewportSize(){
 const [size,setSize]=useState(()=>({width:window.innerWidth,height:window.innerHeight}));
 useEffect(()=>{let frame=0;const resize=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setSize({width:window.innerWidth,height:window.innerHeight}))};window.addEventListener('resize',resize);return()=>{window.removeEventListener('resize',resize);cancelAnimationFrame(frame)}},[]);
 return size;
}

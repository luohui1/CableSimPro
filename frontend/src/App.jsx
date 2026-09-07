import {useState} from 'react'

export default function App(){
 const [result,setResult]=useState(null)
 async function calc(){
  let r=await fetch('http://localhost:8000/calculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({area:240,resistance:0.000075,ambient:25,thermal:1})})
  setResult(await r.json())
 }
 return <div>
 <h1>CableSim Pro</h1>
 <button onClick={calc}>IEC60287 Calculate</button>
 {result&&<pre>{JSON.stringify(result,null,2)}</pre>}
 </div>
}

const root=document.getElementById('root');

root.innerHTML=`
<h1>CableSim Pro</h1>
<h2>IEC60287 Cable Ampacity Calculator</h2>
<label>Conductor Area mm²</label>
<input id="area" value="240"><br>
<label>Resistance Ω/m</label>
<input id="r" value="0.000075"><br>
<button onclick="calc()">Calculate</button>
<pre id="result"></pre>
`;

async function calc(){
 const res=await fetch('http://localhost:8000/calculate',{
 method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({area:Number(area.value),resistance:Number(r.value)})
 });
 document.getElementById('result').textContent=JSON.stringify(await res.json(),null,2);
}
window.calc=calc;

/** Original procedural illustration source; no external images, fonts or CAD assets.
 * Run through render_visual_assets.mjs. These are teaching plates, not run results. */
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {buildCableGeometry} from '../../frontend/src/CableModelView';
import {cableAppearance} from '../../frontend/src/engineering-visuals/cableAppearance';
import type {Cable} from '../../frontend/src/types';

const cable={conductor:'copper',area_mm2:240,fill_factor:.92,conductor_screen_mm:.6,insulation_mm:4.5,insulation_screen_mm:.6,metallic_screen_mm:.35,jacket_mm:2.2} as Cable;
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
renderer.setSize(1200,760);renderer.setPixelRatio(1);renderer.setClearColor('#edf3f8',1);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.style.margin='0';document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();
const environment=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),env=pmrem.fromScene(environment,.04);
scene.environment=env.texture;environment.dispose();pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xffffff,0x617082,2));
const light=new THREE.DirectionalLight(0xffffff,3.6);light.position.set(1.2,2,1.5);light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.camera.left=-2;light.shadow.camera.right=2;light.shadow.camera.top=2;light.shadow.camera.bottom=-2;light.shadow.normalBias=.0002;scene.add(light);
const camera=new THREE.OrthographicCamera(-.29,.29,.184,-.184,.001,30);
const kind=(window as unknown as {assetKind:string}).assetKind||'cable';
function specimen(mode='cutaway') {
 const group=new THREE.Group(),visible=[true,true,true,true,true,true];
 group.add(buildCableGeometry(cable,mode as 'cutaway',visible),cableAppearance(cable,mode,visible));
 group.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true}});return group;
}
function box(w:number,h:number,d:number,color:string,x=0,y=0,z=0,material?:THREE.Material){
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material||new THREE.MeshStandardMaterial({color,roughness:.78}));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);return mesh;
}
function floor(y:number){const p=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.ShadowMaterial({color:'#4c6783',opacity:.17}));p.rotation.x=-Math.PI/2;p.position.y=y;p.receiveShadow=true;scene.add(p)}
if(kind==='cable') {
 const model=specimen();model.rotation.y=-.35;model.rotation.z=.10;scene.add(model);floor(-.055);
 camera.position.set(.4,.21,.48);camera.lookAt(-.014,0,0);camera.zoom=1.3;
} else if(kind==='installation') {
 const soilCanvas=document.createElement('canvas');soilCanvas.width=soilCanvas.height=256;const c=soilCanvas.getContext('2d')!;
 c.fillStyle='#a4937b';c.fillRect(0,0,256,256);let seed=91;
 for(let i=0;i<9000;i++){seed=(1664525*seed+1013904223)>>>0;const x=(seed%256);seed=(1664525*seed+1013904223)>>>0;const y=seed%256;c.fillStyle=i%3?'#897760':'#c0b199';c.fillRect(x,y,i%3+1,2)}
 const tex=new THREE.CanvasTexture(soilCanvas);tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(4,3);
 const soil=new THREE.MeshStandardMaterial({color:'#c6b39a',map:tex,roughness:.97});
 // Deliberate open cutaway, no trench-wall/duct assumption imported into the solver.
 box(.56,.105,.45,'#b3a28c',0,-.098,0,soil);
 box(.56,.085,.45,'#ad9c84',0,-.190,0,soil);
 box(.56,.015,.45,'#899477',0,-.242,0);
 [-.16,0,.16].forEach((x,i)=>{const g=specimen('assembled');g.rotation.y=Math.PI/2;g.position.set(x,-.025,.045);scene.add(g);
 const band=new THREE.Mesh(new THREE.TorusGeometry(.017,.0012,8,72),new THREE.MeshStandardMaterial({color:['#be754a','#d4ae39','#5489b7'][i]}));band.position.set(x,-.025,.115);scene.add(band)});
 floor(-.26);camera.left=-.48;camera.right=.48;camera.top=.304;camera.bottom=-.304;camera.position.set(.65,.65,1.0);camera.lookAt(0,-.09,0);camera.zoom=1.06;
} else {
 box(.26,.014,.32,'#dae4ee',-.04,-.038,0);box(.25,.012,.31,'#ffffff',-.028,-.025,-.005);
 // Abstract data rows, not a counterfeit manufacturer document.
 for(let row=0;row<8;row++){box(.14,.001,.009,row===0?'#397ea5':'#bccddd',-.055,-.018,-.10+row*.022)}
 box(.014,.001,.23,'#158b9a',-.137,-.018,-.02);
 const g=specimen();g.scale.setScalar(.63);g.position.set(.075,.014,.068);g.rotation.y=-.48;g.rotation.z=.25;scene.add(g);
 floor(-.058);camera.position.set(.40,.46,.52);camera.lookAt(0,0,0);camera.zoom=1.22;
}
camera.updateProjectionMatrix();renderer.render(scene,camera);
(window as unknown as {assetReady:boolean}).assetReady=true;

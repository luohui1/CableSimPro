import * as THREE from 'three';

/** Fit a finite presentation sample. Does not change any radial engineering dimension. */
export function fitWorkflowPortrait(camera:THREE.OrthographicCamera,object:THREE.Object3D){
 const bounds=new THREE.Box3().setFromObject(object);
 if(bounds.isEmpty())return;
 camera.zoom=1;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
 const corner=new THREE.Vector3();let extentX=0,extentY=0;
 for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
  corner.set(x,y,z).project(camera);extentX=Math.max(extentX,Math.abs(corner.x));extentY=Math.max(extentY,Math.abs(corner.y));
 }
 camera.zoom=Math.min(16,Math.max(.5,Math.min(.86/Math.max(extentX,1e-6),.62/Math.max(extentY,1e-6))));
 camera.updateProjectionMatrix();
}
/** A visible selection rim belongs to the renderer only, never GLB or the solver. */
export function selectionRim(){
 const rim=new THREE.Mesh(new THREE.TorusGeometry(1,.006,8,96),new THREE.MeshBasicMaterial({color:'#2985d4',transparent:true,opacity:.85}));
 rim.name='Selected layer / display only';rim.rotation.y=Math.PI/2;rim.visible=false;
 rim.userData={display_only:true,exclude_from_fit:true,exclude_from_export:true};
 return rim;
}

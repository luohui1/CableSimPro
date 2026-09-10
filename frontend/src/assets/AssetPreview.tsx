import {Activity,BookOpen,Box,FileText,Layers3,Settings2} from 'lucide-react';
import type {AssetKind,AssetRelease} from './types';
export const kindIcons={material:Settings2,component:Box,assembly:Layers3,installation:Box,study_template:Activity,rule:BookOpen};
const layerColors:Record<string,string>={conductor:'var(--wb-color-copper)',conductor_screen:'var(--wb-color-screen)',insulation:'var(--wb-color-insulation)',insulation_screen:'var(--wb-color-screen)',metallic_screen:'#8b9bae',jacket:'var(--wb-color-jacket)'};
export function AssetGlyph({kind,size=20}:{kind:AssetKind;size?:number}){const Icon=kindIcons[kind]??FileText;return <Icon size={size}/>}
/** Semantic recipe preview at true radial proportions, not a simulation result or CAD export. */
export default function AssetPreview({release}:{release:AssetRelease}){
 const layers=release.geometry_recipe?.layers;
 if(!layers?.length)return <div className="asset-preview asset-preview-symbol"><AssetGlyph kind={release.kind} size={44}/><span>参数定义 · 无几何配方</span></div>;
 const radius=layers.at(-1)!.outer_radius_m;
 return <div className="asset-preview"><svg viewBox="0 0 280 190" role="img" aria-label="资产结构截面（比例预览）">
  <defs><radialGradient id="asset-stage-gradient"><stop stopColor="#f4f8fc"/><stop offset="1" stopColor="#fff"/></radialGradient></defs>
  <rect width="280" height="190" fill="url(#asset-stage-gradient)"/>
  {[...layers].reverse().map(layer=><circle key={layer.uid} cx="140" cy="85" r={layer.outer_radius_m/radius*63} fill={layerColors[layer.role]??'#b2bac6'} stroke="#fff" strokeWidth="0.5"/>)}
  <path d="M 77 157 H 203 M 77 153 V 161 M 203 153 V 161" fill="none" stroke="#526783" strokeWidth="1"/>
  <text x="140" y="178" textAnchor="middle" fill="#344965" fontSize="12">外径 {(radius*2000).toFixed(2)} mm</text>
 </svg><span>按保存配方绘制，不代表已构建原生模型</span></div>;
}

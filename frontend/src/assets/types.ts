export type AssetKind='material'|'component'|'assembly'|'installation'|'study_template'|'rule';
export type AssetStatus='draft'|'reviewed'|'published'|'deprecated';
export type AssetAction='review'|'publish'|'return_to_draft'|'deprecate';
export interface AssetQuantity {value:number;unit:string;dimension:string}
export interface AssetRelease {
 asset_id:string;version:string;kind:AssetKind;name:string;
 parameters:{name:string;quantity:AssetQuantity;overridable:boolean}[];
 dependencies:{asset_id:string;version:string;content_sha256:string}[];
 files:{path:string;sha256:string;size_bytes:number}[];
 sources:{kind:string;reference:string;reviewed:boolean}[];
 geometry_recipe:null|{family:'single_core_circular';representation:'declarative_recipe';length_m:number;
  layers:{uid:string;role:string;inner_radius_m:number;outer_radius_m:number}[]};
}
export interface AssetRow {
 id:string;asset_id:string;version:string;kind:AssetKind;name:string;status:AssetStatus;
 revision:number;content_sha256:string;created:string;updated:string;
}
export interface AssetDetail extends AssetRow {
 release:AssetRelease;issues:{code:string;message:string}[];reviewed_sha256:string|null;
 events:{revision:number;action:string;note:string;content_sha256:string;created:string}[];
 authority:'local_operator';applied_to_workspace:false;
}
export interface AssetCatalog {items:AssetRow[];total:number;counts:Partial<Record<AssetKind,number>>;limit:number;offset:number}
export const assetKinds:Record<AssetKind,string>={material:'材料',component:'部件',assembly:'电缆装配',installation:'敷设场景',study_template:'研究模板',rule:'知识与规则'};
export const statusLabels:Record<AssetStatus,string>={draft:'草稿',reviewed:'已核对',published:'本机已发布',deprecated:'已弃用'};
export const actionLabels:Record<AssetAction,string>={review:'记录人工核对',publish:'发布此版本',return_to_draft:'退回草稿',deprecate:'弃用此版本'};

export async function assetRequest<T>(path:string,options:RequestInit={}):Promise<T>{
 const response=await fetch(path,{cache:'no-store',...options,headers:{'Content-Type':'application/json',...options.headers}});
 const body=await response.json().catch(()=>null);
 if(!response.ok){
  const d=body?.detail;
  const message=typeof d==='string'?d:typeof d?.message==='string'?d.message:Array.isArray(d)?d.map((e:{loc?:unknown[];msg?:string})=>`${e.loc?.join('.')??'输入'}：${e.msg??'无效'}`).join('；'):`请求未完成（HTTP ${response.status}）`;
  throw new Error(message);
 }
 return body as T;
}

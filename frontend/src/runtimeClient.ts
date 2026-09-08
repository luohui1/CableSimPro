import {api} from './utils';
export interface InvocationResult<T> {task_id:string;capability:string;base_revision:number;input_sha256:string;runtime_version:string;result:T}
export async function engineeringCall<T>(workspace:string, revision:number, capability:string, args:unknown={}) : Promise<T> {
 const response=await api<InvocationResult<T>>(`/api/runtime/${workspace}/invoke`,{
  capability,expected_revision:revision,request_id:crypto.randomUUID(),arguments:args,
 },'POST',115000);
 return response.result;
}

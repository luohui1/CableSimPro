import LegacyWorkspace, {EnterpriseWorkbench as LegacyWorkbench} from './LegacyEnterpriseWorkspace';
import {ReferenceWorkbench} from './ReferenceWorkbench';
/** The embedded professional surface follows the approved image. Older entrypoints
 * retain their existing component tree, providers and behavior unchanged. */
export function EnterpriseWorkbench(props:Parameters<typeof ReferenceWorkbench>[0]){
 return props.embedded?<ReferenceWorkbench {...props}/>:<LegacyWorkbench {...props}/>;
}
export default LegacyWorkspace;

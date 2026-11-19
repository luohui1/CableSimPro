import { useEffect, useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { message, optionalRecord, text } from '@/api/client';
import { modelVersions } from '@/api/research';
import { creationOptions } from '@/features/type/creation-api';
import { LazyCreateStudyDialog } from '@/components/lazy-create-study-dialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { LoadingState } from '@/components/states';
import './resources.css';

export function VersionStart({ id, theme, onDialogChange }: { id: string; theme: 'light' | 'dark'; onDialogChange: (open: boolean) => void }) {
  const models = useQuery({ queryKey: ['model-versions'], queryFn: ({ signal }) => modelVersions(signal) });
  const options = useQuery({ queryKey: ['type-creation-options'], queryFn: ({ signal }) => creationOptions(signal), retry: false });
  const research = models.data?.find(model => model.id === id || model.id === `candidate:${id}`);
  const type = options.data?.library.find(model => model.id === id);
  const [studyOpen, setStudyOpen] = useState(false), [typeOpen, setTypeOpen] = useState(false), [loadError, setLoadError] = useState('');
  const [TypeDialog, setTypeDialog] = useState<ComponentType<{ id: string; theme: 'light' | 'dark'; onClose: () => void }> | null>(null);
  useEffect(() => { onDialogChange(studyOpen || typeOpen); return () => onDialogChange(false); }, [studyOpen, typeOpen, onDialogChange]);
  async function openType() {
    setTypeOpen(true); setLoadError('');
    try { const module = await import('./type-version-dialog'); setTypeDialog(() => module.TypeVersionDialog); }
    catch (error) { setLoadError(message(error)); }
  }
  const researchReason = models.isPending ? '正在读取可用于研究的固定版本。' : models.error ? `研究版本读取失败：${message(models.error)}` : !research || !optionalRecord(research.payload).cable_type ? '此版本尚未提供研究所需的完整结构；请先在型号设计中补齐结构与工程参数。' : '';
  const typeReason = options.isPending ? '正在读取可复制的固定版本。' : options.error ? `型号起点读取失败：${message(options.error)}` : !type ? '此版本不在可复制型号清单中，请核对发布状态与内容。' : '';
  return <section className="resource-version-start" aria-label="使用固定型号版本">
    <div className="resource-actions"><Button size="compact" disabled={!!researchReason} title={researchReason || undefined} onClick={() => setStudyOpen(true)}>用于载流量研究</Button>
      <Button size="compact" disabled={!!typeReason} title={typeReason || undefined} onClick={() => void openType()}>建立型号草稿</Button></div>
    <p className="muted">研究入口以所选固定版本新建工程；型号入口建立独立草稿。来源和缺项随版本保留。</p>
    {researchReason && <p className="muted">{researchReason}</p>}{typeReason && <p className="muted">{typeReason}</p>}
    {(models.error || options.error) && <Button size="compact" onClick={() => { void models.refetch(); void options.refetch(); }}>重新读取可用起点</Button>}
    {research && <LazyCreateStudyDialog {...{ open: studyOpen, onOpenChange: setStudyOpen, theme, initialTask: 'rating', initialModelId: text(research.id) }} />}
    {typeOpen && (TypeDialog ? <TypeDialog id={id} theme={theme} onClose={() => setTypeOpen(false)} /> : <Dialog open onOpenChange={setTypeOpen} title="新建型号设计" initialFocus="preserve"
      actions={loadError ? <Button variant="primary" onClick={() => void openType()}>重新打开创建界面</Button> : undefined}>
      {loadError ? <p role="alert">创建界面读取失败：{loadError}</p> : <LoadingState title="正在打开创建界面" />}
    </Dialog>)}
  </section>;
}

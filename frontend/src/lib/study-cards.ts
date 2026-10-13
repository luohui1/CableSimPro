import { api, ApiError, array, numeric, optionalRecord, record, responseData, text } from '@/api/client';
import { workspaces, type StudyDefinition } from '@/api/research';
import { rootModule } from './study-config';

/** Read-only display cards. Never use their projected definition as editable input. */
export async function studyCardIndex(signal?: AbortSignal, projects = workspaces(signal)) {
  const savedProjects = await projects;
  return (await Promise.all(savedProjects.map(async project => {
    const wid = text(project.id);
    if (!wid) throw new ApiError(502, '工程响应缺少身份');
    const values = array(await responseData(api.GET('/api/workspaces/{wid}/studies', {
      params: { path: { wid }, query: { view: 'summary' } }, signal,
    })), '研究名片');
    return values.map(value => {
      const raw = record(value), definition = record(raw.definition);
      const id = text(raw.id), revision = numeric(raw.revision), title = text(definition.title);
      if (!id || !title || revision === null || !text(optionalRecord(definition.method).capability))
        throw new ApiError(502, '研究名片缺少名称、版本或方法身份');
      // The server retains all identity fields used by rootModule, including
      // method_input.schema_version, but omits inputs and batch case payloads.
      return { id, workspace: wid, title, revision, workspaceRevision: numeric(raw.workspace_revision) ?? numeric(project.revision) ?? undefined,
        module: rootModule(definition as StudyDefinition), raw };
    });
  }))).flat();
}

export type StudyCardRow = Awaited<ReturnType<typeof studyCardIndex>>[number];

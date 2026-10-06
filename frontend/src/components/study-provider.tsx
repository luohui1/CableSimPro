import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useReducer,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  useBlocker,
  useParams,
  useSearch,
  useLocation,
} from "@tanstack/react-router";
import { message, numeric, text } from "@/api/client";
import { studyContextQuery, studyRunsQuery, workspaceQuery } from "@/lib/study-queries";
import {
  saveStudy,
  restoreStudy,
  type StudyRow,
  type StudyDefinition,
} from "@/api/research";
import { saveDomain, undoDomain } from "@/api/workspace-input";
import {
  change,
  commitFields,
  displayed,
  type DomainDocument,
  type DomainDraft,
  type NumericInput,
} from "@/lib/domain-fields";
import { commitParameters, type ParameterDraft } from "@/lib/study-config";
import { preferences } from "@/lib/preferences";
import {
  domainDraftReducer,
  emptyDomainHistory,
} from "@/lib/domain-draft-history";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { ErrorState, LoadingState } from "./states";

type Draft = {
  title: string;
  base: StudyRow;
  workspaceRevision: number;
  definition?: StudyDefinition;
  parameterFields?: Record<string, ParameterDraft>;
};
type StudyContextValue = {
  study: StudyRow;
  workspace: Record<string, unknown>;
  runs: Record<string, unknown>[];
  loadingRuns: boolean;
  runError: unknown;
  draft: Draft | null;
  editTitle: (value: string) => void;
  discard: () => void;
  save: () => Promise<boolean>;
  saving: boolean;
  saveError: unknown;
  refresh: () => void;
  notice: (value: string) => void;
  domain?: DomainDocument;
  domainDraft: DomainDraft | null;
  dirty: boolean;
  editDomainText: (
    spec: NumericInput,
    value: string | undefined,
    scope: string,
  ) => void;
  editDomainValue: (path: string, value: unknown, scope: string) => void;
  editDomainDocument: (
    document: DomainDocument,
    scope: string,
    consumed: string[],
  ) => void;
  editDefinition: (definition: StudyDefinition) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  editParameterText: (field: ParameterDraft | undefined, key: string) => void;
  moduleInputs: Record<string, { revision: number; studyRevision: number; value: unknown }>;
  editModuleInput: (module: string, value: unknown | undefined) => void;
};
const Context = createContext<StudyContextValue | null>(null);
export function useStudy() {
  const value = useContext(Context);
  if (!value) throw new Error("研究上下文未加载");
  return value;
}

export function StudyProvider() {
  const { sid } = useParams({ from: "/studies/$sid" });
  const search = useSearch({ from: "/studies/$sid" });
  const location = useLocation();
  const queries = useQueryClient();
  const index = useQuery(studyContextQuery(queries, search.workspace, sid));
  const study = index.data?.find((item) => item.id === sid);
  const wid = study?.workspace || search.workspace;
  const workspace = useQuery({ ...workspaceQuery(wid), enabled: !!study });
  const runs = useQuery({
    ...studyRunsQuery(wid, sid, search.run),
    enabled: !!study,
    refetchInterval: (query) =>
      query.state.data?.some((run) =>
        ["accepted", "queued", "running", "validating"].includes(
          text(run.status),
        ),
      )
        ? 2000
        : false,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [moduleInputs, setModuleInputs] = useState<StudyContextValue["moduleInputs"]>({});
  const [domainHistory, dispatchDomain] = useReducer(
    domainDraftReducer,
    emptyDomainHistory,
  );
  const domainDraft = domainHistory.present;
  const setDomainDraft = (update: SetStateAction<DomainDraft | null>) =>
    dispatchDomain({ type: "set", update });
  useEffect(() => {
    dispatchDomain({ type: "set", update: null });
    setDraft(null);
    setModuleInputs({});
  }, [sid, wid]);
  const [notice, setNotice] = useState("");
  const writing = useRef(false);
  const [restoring, setRestoring] = useState(false);
  const historyRequest = useRef<{ key: string; id: string } | null>(null);
  const restoreConfiguration = useCallback(async (direction: "undo" | "redo") => {
    if (!study || !workspace.data || writing.current) return;
    const revision = numeric(workspace.data.revision)!;
    const key = [wid, sid, direction, revision, study.revision].join(":");
    if (historyRequest.current?.key !== key) historyRequest.current = { key, id: crypto.randomUUID() };
    writing.current = true;
    setRestoring(true);
    try {
      await restoreStudy(wid, sid, direction, { expected_revision: revision, expected_study_revision: study.revision, request_id: historyRequest.current.id });
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["study-index"] }),
        queries.invalidateQueries({ queryKey: ["study-context"] }),
        queries.invalidateQueries({ queryKey: ["runs", wid, sid] }),
      ]);
      historyRequest.current = null;
    } catch (error) { setNotice(message(error)); }
    finally { writing.current = false; setRestoring(false); }
  }, [study, workspace.data, wid, sid, queries]);
  const mutation = useMutation({
    retry: false,
    mutationFn: async (pending: Draft | undefined) => {
      if (!pending) return;
      if (!pending.title.trim()) throw new Error("研究名称不能为空");
      const definition = commitParameters(
        pending.definition || pending.base.definition,
        pending.parameterFields || {},
      );
      await saveStudy(
        pending.base,
        pending.workspaceRevision,
        pending.title.trim(),
        definition,
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["study-index"] }),
        queries.invalidateQueries({ queryKey: ["study-context"] }),
        queries.invalidateQueries({ queryKey: ["runs", wid, sid] }),
        queries.invalidateQueries({ queryKey: ["workspace", wid] }),
      ]);
      setDraft(null);
    },
  });
  const save = useCallback(async () => {
    if (!draft || writing.current) return false;
    const invalid = document.querySelector<HTMLElement>('.buzzform-contract :is(input, textarea, button)[aria-invalid="true"]');
    if (invalid) {
      invalid.focus();
      invalid.scrollIntoView({block:'nearest'});
      return false;
    }
    writing.current = true;
    try {
      await mutation.mutateAsync(draft);
      return true;
    } catch {
      /* field and header retain the error and draft */
      return false;
    } finally {
      writing.current = false;
    }
  }, [draft, mutation]);
  const domainMutation = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!domainDraft) return;
      return saveDomain(wid, domainDraft.revision, commitFields(domainDraft));
    },
    onSuccess: async (value) => {
      const revision = numeric(value?.revision);
      if (revision !== null)
        setDraft((previous) =>
          previous && previous.workspaceRevision === domainDraft?.revision
            ? { ...previous, workspaceRevision: revision }
            : previous,
        );
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["workspace", wid] }),
        queries.invalidateQueries({ queryKey: ["study-index"] }),
        queries.invalidateQueries({ queryKey: ["study-context"] }),
        queries.invalidateQueries({ queryKey: ["runs", wid, sid] }),
      ]);
      setDomainDraft(null);
    },
  });
  const saveInput = useCallback(async () => {
    if (writing.current) return false;
    if (Object.keys(moduleInputs).length) {
      setNotice("请先确认扫描设置或保存批量配置，再保存研究；未确认内容仍保留。");
      return false;
    }
    if (domainDraft) {
      writing.current = true;
      try {
        const value = await domainMutation.mutateAsync();
        if (draft) {
          const revision = numeric(value?.revision);
          const next =
            revision !== null &&
            draft.workspaceRevision === domainDraft.revision
              ? { ...draft, workspaceRevision: revision }
              : draft;
          await mutation.mutateAsync(next);
        }
        return true;
      } catch {
        return false;
      } finally {
        writing.current = false;
      }
    }
    return save();
  }, [draft, domainDraft, domainMutation, mutation, save, moduleInputs]);
  // 模型（电缆、截面、工况）有未保存改动时，撤销/重做作用于模型；否则作用于研究配置的已保存版本
  const modelEditing = domainHistory.past.length > 0 || domainHistory.future.length > 0 || !!domainDraft;
  // 只有查看已过期的运行才视为固定只读；刚运行完的当前运行仍可继续编辑
  const pinnedRun = !!search.run && (runs.data || []).find((item) => item.id === search.run)?.freshness !== "current";
  const undo = useCallback(async () => {
    if (writing.current) return;
    if (pinnedRun) {
      setNotice("固定运行输入只读，请返回当前输入后撤销。");
      return;
    }
    if (
      domainHistory.past.length
    ) {
      dispatchDomain({ type: "undo" });
      return;
    }
    if (draft || domainDraft || Object.keys(moduleInputs).length) {
      setNotice("请先保存或放弃草稿，再撤销已保存版本。");
      return;
    }
    if (!modelEditing) {
      await restoreConfiguration("undo");
      return;
    }
    try {
      const value = await undoDomain(wid, workspace.data!);
      queries.setQueryData(["workspace", wid], value);
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["study-index"] }),
        queries.invalidateQueries({ queryKey: ["study-context"] }),
        queries.invalidateQueries({ queryKey: ["runs", wid, sid] }),
      ]);
    } catch (error) {
      setNotice(message(error));
    }
  }, [
    modelEditing,
    pinnedRun,
    draft,
    domainDraft,
    location.pathname,
    wid,
    sid,
    workspace.data,
    queries,
    domainHistory.past.length,
    search.run,
    moduleInputs,
    restoreConfiguration,
  ]);
  const redo = useCallback(async () => {
    if (writing.current) return;
    if (pinnedRun) {
      setNotice("固定运行输入只读，请返回当前输入后重做。");
      return;
    }
    if (!modelEditing) {
      if (draft || domainDraft || Object.keys(moduleInputs).length) {
        setNotice("请先保存或放弃草稿，再重做已保存版本。");
        return;
      }
      await restoreConfiguration("redo");
      return;
    }
    if (domainHistory.future.length) {
      dispatchDomain({ type: "redo" });
      return;
    }
    if (draft || domainDraft) {
      setNotice("请先保存或放弃草稿，再重做已保存版本。");
      return;
    }
    try {
      const value = await undoDomain(wid, workspace.data!, "redo");
      queries.setQueryData(["workspace", wid], value);
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["study-index"] }),
        queries.invalidateQueries({ queryKey: ["study-context"] }),
        queries.invalidateQueries({ queryKey: ["runs", wid, sid] }),
      ]);
    } catch (error) {
      setNotice(message(error));
    }
  }, [
    modelEditing,
    pinnedRun,
    draft,
    domainDraft,
    domainHistory.future.length,
    location.pathname,
    search.run,
    wid,
    sid,
    workspace.data,
    queries,
    moduleInputs,
    restoreConfiguration,
  ]);
  const blocker = useBlocker({
    shouldBlockFn: ({ next }) =>
      !!(draft || domainDraft || Object.keys(moduleInputs).length) &&
      (!next.pathname.startsWith(`/studies/${sid}/`) ||
        ("workspace" in next.search &&
          !!next.search.workspace &&
          next.search.workspace !== wid)),
    enableBeforeUnload: !!(draft || domainDraft || Object.keys(moduleInputs).length),
    withResolver: true,
  });
  const shortcuts = useRef({ saveInput, undo, redo });
  shortcuts.current = { saveInput, undo, redo };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void shortcuts.current.saveInput();
      }
      const editing =
        event.target instanceof HTMLElement &&
        !!event.target.closest('input,textarea,[contenteditable="true"]');
      if (event.key.toLowerCase() === "z" && !editing) {
        event.preventDefault();
        void (event.shiftKey
          ? shortcuts.current.redo()
          : shortcuts.current.undo());
      }
      if (event.key.toLowerCase() === "y" && !editing) {
        event.preventDefault();
        void shortcuts.current.redo();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  let problem = index.error || workspace.error;
  if (!index.isPending && !index.error && !study)
    problem = new Error("研究不存在，请返回研究列表。");
  if (study && search.workspace && study.workspace !== search.workspace)
    problem = new Error("研究与地址中的工程不一致。");
  if (problem)
    return (
      <ProviderState>
        <ErrorState
          description={message(problem)}
          action={<Button onClick={() => index.refetch()}>重新读取</Button>}
        />
      </ProviderState>
    );
  if (index.isPending || workspace.isPending || !study || !workspace.data)
    return (
      <ProviderState>
        <LoadingState title="正在读取研究工作区" />
      </ProviderState>
    );
  const value: StudyContextValue = {
    study,
    workspace: workspace.data,
    runs: runs.data || [],
    loadingRuns: runs.isPending,
    runError: runs.error,
    draft,
    moduleInputs,
    editModuleInput: (module, value) => setModuleInputs(previous => {
      const next = { ...previous };
      if (value === undefined) delete next[module];
      else next[module] = { revision: previous[module]?.revision ?? numeric(workspace.data.revision)!, studyRevision: previous[module]?.studyRevision ?? study.revision, value };
      return next;
    }),
    editTitle: (title) =>
      setDraft((previous) =>
        title === study.title &&
        !previous?.definition &&
        !Object.keys(previous?.parameterFields || {}).length
          ? null
          : {
              ...previous,
              title,
              base: previous?.base || study,
              workspaceRevision:
                previous?.workspaceRevision ||
                numeric(workspace.data.revision)!,
              definition: previous?.definition
                ? { ...previous.definition, title }
                : undefined,
            },
      ),
    discard: () => {
      setDraft(null);
      setDomainDraft(null);
      setModuleInputs({});
      mutation.reset();
      domainMutation.reset();
    },
    save: saveInput,
    saving: mutation.isPending || domainMutation.isPending || restoring,
    saveError: mutation.error || domainMutation.error,
    refresh: () => {
      index.refetch();
      workspace.refetch();
      runs.refetch();
    },
    notice: setNotice,
    domain:
      domainDraft?.document ||
      (workspace.data.domain as DomainDocument | undefined),
    domainDraft,
    dirty: !!(draft || domainDraft),
    editDomainText: (spec, textValue, scope) =>
      setDomainDraft((previous) => {
        if (!workspace.data.domain) return previous;
        const current = previous || {
          document: structuredClone(workspace.data.domain) as DomainDocument,
          base: structuredClone(workspace.data.domain) as DomainDocument,
          revision: numeric(workspace.data.revision)!,
          scope,
          fields: {},
        };
        const fields = { ...current.fields };
        if (
          textValue === undefined ||
          textValue ===
            (displayed(current.document, spec)?.toFixed(spec.precision ?? 0) ||
              "")
        )
          delete fields[spec.path];
        else fields[spec.path] = { spec, value: textValue };
        const next = { ...current, scope, fields };
        return !Object.keys(fields).length &&
          JSON.stringify(next.document) === JSON.stringify(next.base)
          ? null
          : next;
      }),
    editDomainValue: (path, value, scope) =>
      dispatchDomain({
        type: "set",
        record: true,
        consumed: [path],
        update: (previous) => {
          if (!workspace.data.domain) return previous;
          const current = previous || {
            document: structuredClone(workspace.data.domain) as DomainDocument,
            base: structuredClone(workspace.data.domain) as DomainDocument,
            revision: numeric(workspace.data.revision)!,
            scope,
            fields: {},
          };
          return {
            ...current,
            scope,
            document: change(current.document, path, value),
          };
        },
      }),
    editDomainDocument: (document, scope, consumed) =>
      dispatchDomain({
        type: "set",
        record: true,
        consumed,
        update: (previous) => {
          if (!workspace.data.domain) return previous;
          return {
            ...(previous || {
              base: structuredClone(workspace.data.domain) as DomainDocument,
              revision: numeric(workspace.data.revision)!,
              fields: {},
            }),
            scope,
            document,
          };
        },
      }),
    editDefinition: (definition) =>
      setDraft((previous) => ({
        ...previous,
        title: definition.title,
        base: previous?.base || study,
        workspaceRevision:
          previous?.workspaceRevision || numeric(workspace.data.revision)!,
        definition,
      })),
    editParameterText: (field, key) =>
      setDraft((previous) => {
        const fields = { ...previous?.parameterFields };
        if (field) fields[key] = field;
        else delete fields[key];
        if (
          !Object.keys(fields).length &&
          !previous?.definition &&
          (!previous || previous.title === study.title)
        )
          return null;
        return {
          ...previous,
          title: previous?.title || study.title,
          base: previous?.base || study,
          workspaceRevision:
            previous?.workspaceRevision || numeric(workspace.data.revision)!,
          parameterFields: fields,
        };
      }),
    undo,
    redo,
    canUndo:
      !pinnedRun && !restoring && !Object.keys(moduleInputs).length &&
      !!(
        modelEditing
          ? domainHistory.past.length || (!domainDraft && !draft && workspace.data.can_undo)
          : !domainDraft && !draft && study.raw.can_undo
      ),
    canRedo:
      !pinnedRun && !restoring && !Object.keys(moduleInputs).length &&
      !!(
        modelEditing
          ? domainHistory.future.length || (!domainDraft && !draft && workspace.data.can_redo)
          : !domainDraft && !draft && study.raw.can_redo
      ),
  };
  return (
    <Context.Provider value={value}>
      <Outlet />
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.status === "blocked") blocker.reset();
        }}
        title="有未保存修改"
        description="离开该研究前保存，或明确放弃修改。"
        actions={
          blocker.status === "blocked" ? (
            <>
              <Button
                onClick={() => {
                  setDraft(null);
                  setDomainDraft(null);
                  setModuleInputs({});
                  blocker.proceed();
                }}
              >
                放弃并离开
              </Button>
              <Button
                variant="primary"
                loading={mutation.isPending || domainMutation.isPending}
                onClick={async () => {
                  if (await saveInput()) blocker.reset();
                }}
              >
                保存后留在研究
              </Button>
            </>
          ) : undefined
        }
      />
      <Dialog
        open={!!notice}
        onOpenChange={(open) => {
          if (!open) setNotice("");
        }}
        title="操作提示"
        description={notice}
      />
    </Context.Provider>
  );
}
/** 研究读取中或出错时只占内容区，常驻侧栏不动。 */
function ProviderState({ children }: { children: ReactNode }) {
  return (
    <section className="work-panel provider-state">
      <Link to="/studies" search={{ theme: preferences().theme }}>返回研究列表</Link>
      {children}
    </section>
  );
}

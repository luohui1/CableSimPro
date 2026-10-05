import type { SetStateAction } from "react";
import type { DomainDraft } from "./domain-fields";

export type DomainDraftHistory = {
  present: DomainDraft | null;
  past: (DomainDraft | null)[];
  future: (DomainDraft | null)[];
};
export type DomainDraftAction =
  | {
      type: "set";
      update: SetStateAction<DomainDraft | null>;
      record?: boolean;
      consumed?: string[];
    }
  | { type: "undo" }
  | { type: "redo" };
export const emptyDomainHistory: DomainDraftHistory = {
  present: null,
  past: [],
  future: [],
};
function withoutFields(
  draft: DomainDraft | null,
  paths: string[],
): DomainDraft | null {
  if (!draft) return null;
  const fields = Object.fromEntries(
    Object.entries(draft.fields).filter(
      ([path]) =>
        !paths.some(
          (prefix) => path === prefix || path.startsWith(prefix + "/"),
        ),
    ),
  );
  return !Object.keys(fields).length &&
    JSON.stringify(draft.document) === JSON.stringify(draft.base)
    ? null
    : { ...draft, fields };
}
export function domainDraftReducer(
  state: DomainDraftHistory,
  action: DomainDraftAction,
): DomainDraftHistory {
  if (action.type === "undo")
    return state.past.length
      ? {
          present: state.past.at(-1)!,
          past: state.past.slice(0, -1),
          future: [...state.future, state.present],
        }
      : state;
  if (action.type === "redo")
    return state.future.length
      ? {
          present: state.future.at(-1)!,
          past: [...state.past, state.present],
          future: state.future.slice(0, -1),
        }
      : state;
  if (action.update === null) return emptyDomainHistory;
  const next =
    typeof action.update === "function"
      ? action.update(state.present)
      : action.update;
  if (next === state.present) return state;
  const present = action.record
    ? withoutFields(next, action.consumed || [])
    : next;
  return {
    present,
    past: action.record
      ? [...state.past, withoutFields(state.present, action.consumed || [])]
      : state.past,
    future: [],
  };
}

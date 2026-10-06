import type { GridAction } from "./types";

/** Toolbar add-on strings: quick-search, filter menu, columns menu. */
export type DataGridToolbarLabels = {
  searchPlaceholder: string;
  searchAriaLabel: string;
  searchPreviousMatch: string;
  searchNextMatch: string;
  /** e.g. "3/17". */
  searchMatches: (current: number, total: number) => string;
  /** e.g. "3/1000+" when the match count hit the cap. */
  searchMatchesCapped: (current: number) => string;
  /** No search performed yet / zero matches ("0/0"). */
  searchNoMatches: string;
  filter: string;
  filterAriaLabel: string;
  filterColumnAriaLabel: string;
  filterOperatorAriaLabel: string;
  filterValuePlaceholder: string;
  filterValueAriaLabel: string;
  /** Trigger text for the `isAnyOf` multi-choice input; `count` is how many choices are selected. */
  filterValueAnyOfSummary: (count: number) => string;
  /** Option text for a `checkbox`-column filter's value select. */
  filterValueTrue: string;
  filterValueFalse: string;
  /** aria-label for the `isBetween` range's minimum-value input. */
  filterValueFromAriaLabel: string;
  /** aria-label for the `isBetween` range's maximum-value input. */
  filterValueToAriaLabel: string;
  removeFilterAriaLabel: string;
  /** aria-label for a filter row's drag-handle grip (also moved via ArrowUp/ArrowDown while focused). */
  reorderFilterAriaLabel: string;
  /** Polite live-region announcement after a filter row moves; `column` is the filter's column label, `position`/`total` are 1-based. */
  filterReorderAnnouncement: (column: string, position: number, total: number) => string;
  addFilter: string;
  clearFilters: string;
  noFiltersApplied: string;
  /** Static "Where" label shown in the first filter row's join cell (tablecn parity). */
  filterWhere: string;
  /** aria-label for the AND/OR join-operator select, shown once 2+ filters are active. */
  joinOperatorAriaLabel: string;
  joinOperatorAnd: string;
  joinOperatorOr: string;
  columns: string;
  columnsAriaLabel: string;
};

/** Sort-list add-on strings (`data-grid-sort-list`): toolbar sort button + popover of applied sorts. */
export type DataGridSortLabels = {
  sort: string;
  sortAriaLabel: string;
  columnAriaLabel: string;
  directionAriaLabel: string;
  ascending: string;
  descending: string;
  removeSortAriaLabel: string;
  /** aria-label for a sort row's drag-handle grip (also moved via ArrowUp/ArrowDown while focused). */
  reorderSortAriaLabel: string;
  /** Polite live-region announcement after a sort row moves; `column` is the sort's column label, `position`/`total` are 1-based. */
  sortReorderAnnouncement: (column: string, position: number, total: number) => string;
  addSort: string;
  clearSorts: string;
  noSortsApplied: string;
};

/** Per-column filter operator display names (toolbar filter menu's operator `<Select>`). */
export type DataGridFilterOperatorLabels = {
  contains: string;
  notContains: string;
  equals: string;
  notEquals: string;
  startsWith: string;
  endsWith: string;
  empty: string;
  notEmpty: string;
  gt: string;
  gte: string;
  lt: string;
  lte: string;
  isBetween: string;
  isAnyOf: string;
};

/** Cell/header right-click context menu + header dropdown menu strings (shared verbatim between the two surfaces). */
export type DataGridContextMenuLabels = {
  cut: string;
  copy: string;
  paste: string;
  /** Tooltip shown on a blocked paste item (no clipboard-read permission granted). */
  pasteBlocked: string;
  clearContents: string;
  insertRowAbove: string;
  insertRowBelow: string;
  duplicateRow: string;
  duplicateRows: (count: number) => string;
  deleteRow: string;
  deleteRows: (count: number) => string;
  sortAsc: string;
  sortDesc: string;
  clearSort: string;
  pinLeft: string;
  pinRight: string;
  unpin: string;
  hideColumn: string;
  autosize: string;
  /** aria-label for the per-column header dropdown's ghost chevron trigger; `column` is the header text. */
  columnMenuAriaLabel: (column: string) => string;
};

/** Keybindings-dialog add-on strings: title/description + the section headings and native-clipboard rows. */
export type DataGridKeybindingsLabels = {
  title: string;
  description: string;
  categories: {
    navigation: string;
    selection: string;
    editing: string;
    clipboardFill: string;
    history: string;
    other: string;
  };
  /** Native browser clipboard shortcuts listed alongside the keymap (not GridActions). */
  nativeCopy: string;
  nativeCut: string;
  nativePaste: string;
  /** Per-`GridAction` row label shown in the dialog; consumer-added actions absent here fall back to a humanized action name (see `labelForAction`). */
  actions: Partial<Record<GridAction, string>>;
};

/** Row-marker column strings (select-all header checkbox, per-row checkbox, reorder handle). */
export type DataGridMarkerLabels = {
  selectAll: string;
  /** `rowNumber` is 1-based (matches the visible row-number marker). */
  selectRow: (rowNumber: number) => string;
  /** aria-label for the reorder-mode marker handle; `rowNumber` is 1-based. */
  reorderRow: (rowNumber: number) => string;
  /** Polite live-region announcement after a row move; `rowNumber` is the dragged row's 1-based number BEFORE the move, `position`/`total` are 1-based. */
  reorderAnnouncement: (rowNumber: number, position: number, total: number) => string;
};

/** Core grid strings not owned by a specific add-on. */
export type DataGridGridLabels = {
  /** Shown when the view has zero rows (post filter/search); the `emptyState` prop on `DataGridRoot`, when provided, wins over this default. */
  emptyState: string;
  /** aria-label for the loading skeleton region (`loading && rowCount === 0`); also used as the indeterminate progress bar's aria-label when rows are present. */
  loading: string;
  /** Placeholder for the date editor's typed input (default hints the ISO `yyyy-mm-dd` format). */
  datePlaceholder: string;
};

/** Import/export add-on strings (`data-grid-io`): export dropdown + import dialog. */
export type DataGridIOLabels = {
  exportButtonAriaLabel: string;
  exportXlsx: string;
  exportCsv: string;
  importButton: string;
  importDialogTitle: string;
  importDialogDescription: string;
  chooseFile: string;
  noFileChosen: string;
  /** Caption on the compact drop zone shown once a file is already chosen, in the column-mapping step. */
  replaceFile: string;
  /** Fallback column header in the mapping table when "First row is a header" is unchecked; `index` is 1-based. */
  columnFallback: (index: number) => string;
  delimiter: string;
  delimiterComma: string;
  delimiterSemicolon: string;
  delimiterTab: string;
  hasHeaderRow: string;
  mapColumns: string;
  /** One-line hint under the mapping grid explaining why mapped columns disappear from other selects. */
  mapColumnsHint: string;
  mapColumnAriaLabel: (importColumn: string) => string;
  skipColumn: string;
  /** aria-label for the per-row quick-skip (X) button next to the mapping Select. */
  skipColumnQuick: string;
  preview: string;
  previewTruncated: (shown: number, total: number) => string;
  /** Label of the sheet picker shown when an imported workbook has more than one sheet. */
  sheet: string;
  import: string;
  cancel: string;
  errorParseFailed: string;
  errorNoRows: string;
  errorUnsupportedFile: string;
  /** Shown under the mapping grid when the import build rejected cells; `count` is the rejected-cell count. */
  importRejectedCells: (count: number) => string;
  /** Shown when the `onImport` callback rejected; the dialog stays open and the import can be retried. */
  importMergeFailed: string;
};

/** Pagination add-on strings (`data-grid-pagination`): footer prev/next, page numbers, page-size select, range label. */
export type DataGridPaginationLabels = {
  firstPage: string;
  previousPage: string;
  nextPage: string;
  lastPage: string;
  /** aria-label for a numbered page button; `page` is 1-based. */
  pageAriaLabel: (page: number) => string;
  pageSizeAriaLabel: string;
  /** Option text in the page-size select, e.g. "25 / page". */
  pageSizeOption: (size: number) => string;
  /** Footer range label, e.g. "1–25 of 240". `total === 0` renders {@link DataGridPaginationLabels.rangeEmpty} instead. */
  range: (from: number, to: number, total: number) => string;
  rangeEmpty: string;
};

/** Every user-facing default string across core + every add-on, grouped by owning surface. */
export interface DataGridLabels {
  toolbar: DataGridToolbarLabels;
  sort: DataGridSortLabels;
  filterOperators: DataGridFilterOperatorLabels;
  contextMenu: DataGridContextMenuLabels;
  keybindings: DataGridKeybindingsLabels;
  markers: DataGridMarkerLabels;
  grid: DataGridGridLabels;
  io: DataGridIOLabels;
  pagination: DataGridPaginationLabels;
}

/** English defaults — every string in the shipped UI today, verbatim (so adopting `labels` never changes visible copy without an explicit override). */
export const DEFAULT_LABELS: DataGridLabels = {
  toolbar: {
    searchPlaceholder:"查找…",searchAriaLabel:"查找表格",searchPreviousMatch:"上一个匹配项",searchNextMatch:"下一个匹配项",
    searchMatches:(current,total)=>`${current}/${total}`,searchMatchesCapped:current=>`${current}/1000+`,searchNoMatches:"0/0",
    filter:"筛选",filterAriaLabel:"筛选条件",filterColumnAriaLabel:"筛选列",filterOperatorAriaLabel:"筛选方式",
    filterValuePlaceholder:"值",filterValueAriaLabel:"筛选值",filterValueAnyOfSummary:count=>count===0?"任意值":`已选 ${count} 项`,
    filterValueTrue:"是",filterValueFalse:"否",filterValueFromAriaLabel:"最小值",filterValueToAriaLabel:"最大值",
    removeFilterAriaLabel:"删除条件",reorderFilterAriaLabel:"调整条件顺序",
    filterReorderAnnouncement:(column,position,total)=>`${column} 条件已移到第 ${position} 项，共 ${total} 项`,
    addFilter:"添加条件",clearFilters:"清空条件",noFiltersApplied:"没有筛选条件。",filterWhere:"条件",
    joinOperatorAriaLabel:"匹配方式",joinOperatorAnd:"且",joinOperatorOr:"或",columns:"显示列",columnsAriaLabel:"显示列",
  },
  sort:{sort:"排序",sortAriaLabel:"排序条件",columnAriaLabel:"排序列",directionAriaLabel:"排序方向",ascending:"升序",descending:"降序",
    removeSortAriaLabel:"删除排序",reorderSortAriaLabel:"调整排序优先级",
    sortReorderAnnouncement:(column,position,total)=>`${column} 排序已移到第 ${position} 项，共 ${total} 项`,
    addSort:"添加排序",clearSorts:"清空排序",noSortsApplied:"没有排序条件。"},
  filterOperators:{contains:"包含",notContains:"不包含",equals:"等于",notEquals:"不等于",startsWith:"开头为",endsWith:"结尾为",
    empty:"为空",notEmpty:"非空",gt:"大于",gte:"大于等于",lt:"小于",lte:"小于等于",isBetween:"介于",isAnyOf:"属于"},
  contextMenu:{cut:"剪切",copy:"复制",paste:"粘贴",pasteBlocked:"需要剪贴板权限，也可使用 Ctrl+V",clearContents:"清空内容",
    insertRowAbove:"在上方插入行",insertRowBelow:"在下方插入行",duplicateRow:"复制行",duplicateRows:count=>`复制 ${count} 行`,
    deleteRow:"删除行",deleteRows:count=>`删除 ${count} 行`,sortAsc:"升序排列",sortDesc:"降序排列",clearSort:"取消排序",
    pinLeft:"固定到左侧",pinRight:"固定到右侧",unpin:"取消固定",hideColumn:"隐藏列",autosize:"适应内容宽度",columnMenuAriaLabel:column=>`${column} 列菜单`},
  keybindings:{title:"键盘快捷键",description:"当前表格可用的快捷键。",categories:{navigation:"导航",selection:"选择",editing:"编辑",clipboardFill:"剪贴板与填充",history:"撤销与重做",other:"其他"},nativeCopy:"复制",nativeCut:"剪切",nativePaste:"粘贴",
    actions:{moveUp:"向上",moveDown:"向下",moveLeft:"向左",moveRight:"向右",retainMoveUp:"向上并保留选区",retainMoveDown:"向下并保留选区",retainMoveLeft:"向左并保留选区",retainMoveRight:"向右并保留选区",
      scrollActiveIntoView:"定位当前单元格",moveRowStart:"移至行首",moveRowEnd:"移至行尾",jumpUp:"移至上边界",jumpDown:"移至下边界",jumpLeft:"移至左边界",jumpRight:"移至右边界",moveFirstCell:"移至首个单元格",moveLastCell:"移至末个单元格",pageUp:"上一页",pageDown:"下一页",
      extendUp:"向上扩选",extendDown:"向下扩选",extendLeft:"向左扩选",extendRight:"向右扩选",extendJumpUp:"扩选至上边界",extendJumpDown:"扩选至下边界",extendJumpLeft:"扩选至左边界",extendJumpRight:"扩选至右边界",extendFirstCell:"扩选至首个单元格",extendLastCell:"扩选至末个单元格",
      selectRow:"选择行",selectColumn:"选择列",selectAll:"全选",edit:"编辑单元格",editReplace:"输入替换",commitDown:"确认并向下",commitUp:"确认并向上",commitRight:"确认并向右",commitLeft:"确认并向左",cancel:"取消编辑",deleteContents:"清空内容",insertRowBelow:"在下方插入行",insertRowAbove:"在上方插入行",duplicateRow:"复制行",deleteRows:"删除选中行",fillDown:"向下填充",fillRight:"向右填充",undo:"撤销",redo:"重做"}},
  markers:{selectAll:"选择全部行",selectRow:row=>`选择第 ${row} 行`,reorderRow:row=>`移动第 ${row} 行`,reorderAnnouncement:(row,position,total)=>`第 ${row} 行已移到第 ${position} 项，共 ${total} 项`},
  grid:{emptyState:"没有分层记录",loading:"正在读取…",datePlaceholder:"年-月-日"},
  io:{exportButtonAriaLabel:"导出",exportXlsx:"导出 Excel",exportCsv:"导出 CSV",importButton:"导入",importDialogTitle:"导入文件",importDialogDescription:"选择 CSV 或 Excel 文件并指定对应列。",chooseFile:"选择文件",noFileChosen:"未选择文件",replaceFile:"拖放或点击替换文件",
    columnFallback:index=>`第 ${index} 列`,delimiter:"分隔符",delimiterComma:"逗号",delimiterSemicolon:"分号",delimiterTab:"制表符",hasHeaderRow:"首行为表头",mapColumns:"对应列",mapColumnsHint:"每个目标列只能对应一个来源列。",
    mapColumnAriaLabel:column=>`为“${column}”指定目标列`,skipColumn:"跳过此列",skipColumnQuick:"跳过此列",preview:"预览",previewTruncated:(shown,total)=>`显示 ${shown} 行，共 ${total} 行`,sheet:"工作表",import:"导入",cancel:"取消",
    errorParseFailed:"文件读取失败。",errorNoRows:"文件没有数据行。",errorUnsupportedFile:"请选择 CSV、XLSX 或 XLS 文件。",importRejectedCells:count=>`${count} 个单元格未通过校验，已保留为空。`,importMergeFailed:"导入未完成，请重试。"},
  pagination:{firstPage:"首页",previousPage:"上一页",nextPage:"下一页",lastPage:"末页",pageAriaLabel:page=>`转到第 ${page} 页`,pageSizeAriaLabel:"每页行数",pageSizeOption:size=>`每页 ${size} 行`,range:(from,to,total)=>`${from}–${to}，共 ${total} 行`,rangeEmpty:"没有记录"},
};

/** Recursive partial override of {@link DataGridLabels}: arrays and functions are replaced wholesale, plain objects merge key-by-key. */
export type DeepPartialLabels<T = DataGridLabels> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K]
    : T[K] extends readonly unknown[]
      ? T[K]
      : T[K] extends object
        ? DeepPartialLabels<T[K]>
        : T[K];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pure deep merge for label overrides: plain objects merge recursively, everything else (functions, arrays, primitives) replaces the base value wholesale. */
export function deepMergeLabels<T>(base: T, override: DeepPartialLabels<T> | undefined): T {
  if (!override) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return (override as T) ?? base;

  const overrideRecord = override as Record<string, unknown>;
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrideRecord)) {
    const overrideValue = overrideRecord[key];
    const baseValue = (base as Record<string, unknown>)[key];
    result[key] = isPlainObject(baseValue) && isPlainObject(overrideValue) ? deepMergeLabels(baseValue, overrideValue) : overrideValue;
  }
  return result as T;
}

// 实体按钮：硬投影，悬停微微抬起，按下时"压"进投影里（首屏与页尾共用）
const press =
  'transition-[transform,box-shadow] duration-100 hover:-translate-x-px hover:-translate-y-px active:translate-x-[3px] active:translate-y-[3px] active:shadow-none';

export const primaryButton = `inline-flex items-center gap-2 border border-fd-foreground bg-brand px-5 py-2.5 text-[15px] font-medium text-white shadow-[4px_4px_0_0_var(--color-fd-foreground)] dark:text-fd-background ${press}`;

export const secondaryButton = `inline-flex items-center gap-2 border border-fd-foreground bg-fd-card px-5 py-2.5 text-[15px] shadow-[4px_4px_0_0_var(--color-fd-foreground)] ${press}`;

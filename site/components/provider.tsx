'use client';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { useStaticSearch } from 'fumadocs-core/search/client';
import { i18nProvider } from 'fumadocs-ui/i18n';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import { translations } from '@/lib/translations';

// 静态站点：搜索索引在构建时生成，查询在浏览器中完成，离线可用。
function StaticSearchDialog(props: SharedProps) {
  // 站点部署在子路径下时，索引文件也在子路径下
  const search = useStaticSearch({ from: `${process.env.NEXT_PUBLIC_DOCS_BASE ?? ''}/api/search` });
  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
      </SearchDialogContent>
    </SearchDialog>
  );
}

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider i18n={i18nProvider(translations)} search={{ SearchDialog: StaticSearchDialog }}>
      {children}
    </RootProvider>
  );
}

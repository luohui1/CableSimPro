import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

// 首页顶栏多几个入口；文档页的侧栏已经按分区列出，不重复
const links = [
  { text: '全部文档', url: '/docs/' },
  { text: '快速入门', url: '/docs/quickstart/factory/' },
  { text: '方法与依据', url: '/docs/methods/iec-60287/' },
];

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <HomeLayout {...baseOptions()} links={links}>
      {children}
    </HomeLayout>
  );
}

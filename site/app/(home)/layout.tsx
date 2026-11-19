import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

// 首页顶栏多几个入口；文档页的侧栏已经按分区列出，不重复
const links = [
  { text: '文档总览', url: '/docs/' },
  { text: '快速上手', url: '/docs/quickstart/factory/' },
  { text: '安装部署', url: '/docs/install/' },
  { text: '用户指南', url: '/docs/guide/' },
  { text: '方法与依据', url: '/docs/methods/' },
];

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <HomeLayout {...baseOptions()} links={links}>
      {children}
    </HomeLayout>
  );
}

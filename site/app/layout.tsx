import '@fontsource-variable/noto-sans-sc';
import 'katex/dist/katex.min.css';
import './global.css';
import { GeistMono } from 'geist/font/mono';
import { GeistPixelSquare } from 'geist/font/pixel';
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import { Provider } from '@/components/provider';

export const metadata: Metadata = {
  title: { template: '%s | CableSimPro 文档', default: 'CableSimPro 文档' },
  description: '电缆载流量计算、电缆设计、电缆仿真与 Agent：安装、使用、方法依据与结果解读。',
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="zh-CN"
      className={`${GeistSans.variable} ${GeistMono.variable} ${GeistPixelSquare.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}

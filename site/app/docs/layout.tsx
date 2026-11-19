import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { buildStructuredPageTree } from '@/lib/doc-tree';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout tree={buildStructuredPageTree()} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}

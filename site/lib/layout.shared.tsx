import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { BrandMark, BrandWordmark } from '@/components/brand';
import { gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <BrandMark className="h-7 w-auto" />
          <BrandWordmark className="text-[17px]" />
          <span className="font-normal text-fd-muted-foreground">文档</span>
        </>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}

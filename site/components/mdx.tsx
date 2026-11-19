import { Callout } from 'fumadocs-ui/components/callout';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { ExampleCode } from '@/components/example-code';
import { ManifestFields } from '@/components/manifest-fields';
import { Mermaid } from '@/components/mermaid';
import { OpenApiReference } from '@/components/openapi-reference';
import { PluginCatalog } from '@/components/plugin-catalog';
import { PluginMethods } from '@/components/plugin-methods';
import { VideoPlayer } from '@/components/video-player';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // 截图可点击放大
    img: (props) => <ImageZoom {...(props as React.ComponentProps<typeof ImageZoom>)} />,
    Callout,
    Card,
    Cards,
    Step,
    Steps,
    Mermaid,
    PluginMethods,
    PluginCatalog,
    ManifestFields,
    ExampleCode,
    OpenApiReference,
    VideoPlayer,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}

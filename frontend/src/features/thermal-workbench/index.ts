import { createElement, type ComponentProps } from 'react';
import { ViewBoundary } from '@/components/view-boundary';
import { StudyVisualWorkbench as Workbench } from './visual-workspace';

export function StudyVisualWorkbench(props: ComponentProps<typeof Workbench>) {
  return createElement(ViewBoundary, { resetValue: props.run, title: '可视化显示失败', children: createElement(Workbench, props) });
}

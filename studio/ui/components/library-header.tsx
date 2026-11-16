import { Link } from '@tanstack/react-router';
import { ProductIcon as Icon, ToolButton } from './product-controls';
import { Popover } from '@mantine/core';
import { useState } from 'react';

export function LibraryHeader() {
  const [helpOpen, setHelpOpen] = useState(false);
  return <header className="library-header">
    <nav aria-label="工作区" className="library-workspaces">
      <Link to="/library" aria-current="page" className="is-current"><Icon name="nav/library" />产品库</Link>
      <Link to="/workbench"><Icon name="object/section" />断面工作台</Link>
    </nav>
    <div className="flex-1" />
    <Popover position="bottom-end" width={340} withinPortal opened={helpOpen} onChange={setHelpOpen} trapFocus returnFocus>
      <Popover.Target><button type="button" className="library-help" aria-label="查看使用流程" onClick={() => setHelpOpen(open => !open)}><Icon name="help" /><span>使用流程</span></button></Popover.Target>
      <Popover.Dropdown className="product-ui"><div className="workflow-help"><div className="flex items-center justify-between gap-2"><strong>从结构表到规格书</strong><ToolButton icon="action/close" label="关闭使用流程" onClick={() => setHelpOpen(false)} /></div><ol>
        <li><b>导入资料</b><span>上传结构表，确认列对应、系列声明和数据来源。</span></li>
        <li><b>计算与核对</b><span>打开系列，计算全系列或勾选项，查看标准核对与拒算原因。</span></li>
        <li><b>人工审核</b><span>勾选规格后提交审核，填写意见；审核状态单独保留。</span></li>
        <li><b>导出规格书</b><span>打开一个规格，在“版本与文件”生成和下载 PDF。</span></li>
      </ol></div></Popover.Dropdown>
    </Popover>
  </header>;
}

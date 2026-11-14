// Every control of the rule set in every state, on one page (/gallery). A new screen takes its
// controls from here; a control that is not here does not exist.
import { useState, type ReactNode } from 'react';
import { Button, ToolButton, ToolGroup, ToolToggle } from '@/components/button';
import { Badge, Facts, Meter, Seal } from '@/components/marks';
import { Menu, MenuItem, Popover } from '@/components/popover';
import { Segmented } from '@/components/segmented';
import { TabPanel, Tabs } from '@/components/tabs';

function Row({ title, rule, children }: { title: string; rule: string; children: ReactNode }) {
  return <section className="grid grid-cols-[260px_minmax(0,1fr)] gap-8 border-t border-line pt-6">
    <div>
      <h2 className="m-0 text-16 font-strong text-ink">{title}</h2>
      <p className="m-0 mt-1 text-14 text-ink-2">{rule}</p>
    </div>
    <div className="flex flex-wrap items-center gap-3">{children}</div>
  </section>;
}

export function Gallery() {
  const [segment, setSegment] = useState<'load' | 'rated'>('load');
  const [tab, setTab] = useState<'why' | 'object'>('why');
  const [layer, setLayer] = useState(true);
  const [choice, setChoice] = useState('一');
  return <div className="h-full overflow-y-auto bg-panel">
    <div className="mx-auto grid max-w-[1040px] gap-8 px-8 py-10">
      <h1 className="m-0 text-20 font-strong text-ink">组件</h1>
      <Row title="按钮" rule="药丸形。对工程的动作：运行、导出、切换工程。铜色只给主动作。">
        <Button variant="primary" icon="run/run">运行校核</Button>
        <Button icon="result/report">计算书</Button>
        <Button variant="ghost">次要动作</Button>
        <Button size="compact">紧凑</Button>
        <Button variant="primary" busy>计算中</Button>
        <Button disabled>不可用</Button>
      </Row>
      <Row title="画布工具" rule="圆角方形，成组浮在图上。按一下执行的工具，和常开的图层开关。">
        <ToolGroup>
          <ToolButton icon="tool/zoom-out" label="缩小" />
          <ToolButton icon="tool/fit" label="适应" />
          <ToolButton icon="tool/zoom-in" label="放大" />
        </ToolGroup>
        <ToolGroup>
          <ToolToggle icon="result/field" label="温度场" pressed={layer} onChange={setLayer} />
          <ToolToggle icon="tool/dimension" label="尺寸" pressed={!layer} onChange={value => setLayer(!value)} />
        </ToolGroup>
      </Row>
      <Row title="分段器" rule="凹槽加滑块。同一个视图的几种互斥状态。">
        <Segmented label="工况" value={segment} onChange={setSegment} options={[{ value: 'load', label: '保存负荷 300 A' }, { value: 'rated', label: '额定 330.3 A' }]} />
      </Row>
      <Row title="标签页" rule="平字加下划线。同一个位置的不同内容。">
        <Tabs className="w-full" value={tab} onChange={setTab} items={[{ value: 'why', label: '为什么是这个数' }, { value: 'object', label: '对象' }]}>
          <TabPanel value="why" className="px-5 py-3 text-14 text-ink-2">第一页的内容</TabPanel>
          <TabPanel value="object" className="px-5 py-3 text-14 text-ink-2">第二页的内容</TabPanel>
        </Tabs>
      </Row>
      <Row title="印鉴" rule="方形双线。方法的信任等级，常驻。">
        <Seal tier="deliverable" label="可交付" />
        <Seal tier="reference" label="参考" />
        <Seal tier="exploratory" label="探索" />
      </Row>
      <Row title="徽标" rule="实心小签。只在需要人处理时出现。">
        <Badge tone="attention">已过期</Badge>
        <Badge tone="error">拒算</Badge>
        <Badge tone="agent">待审阅</Badge>
        <Badge tone="ink">限制</Badge>
      </Row>
      <Row title="量条" rule="一个值对着它的限值。超过限值变成错误色。">
        <div className="grid w-80 gap-4">
          <Meter value={76.7} min={25} max={90} />
          <Meter value={96.5} min={25} max={90} />
        </div>
      </Row>
      <Row title="标签和数值" rule="标签在左，数值在右对齐。次要数值都用这个形式，不写成一行小字。">
        <Facts className="w-80" rows={[{ label: '口径', value: '全回路共同能力' }, { label: '先到温限', value: '回路 2' }, { label: '土壤热阻率', value: '1.2 K·m/W' }]} />
      </Row>
      <Row title="浮层和菜单" rule="从它所说明的控件上打开。">
        <Popover trigger={<Button>打开浮层</Button>}><p className="m-0 text-14 text-ink">浮层里放这个控件的完整内容。</p></Popover>
        <Menu trigger={<Button>选择：{choice}</Button>}>
          {['一', '二', '三'].map(item => <MenuItem key={item} checked={item === choice} onSelect={() => setChoice(item)}>选项{item}</MenuItem>)}
        </Menu>
      </Row>
    </div>
  </div>;
}

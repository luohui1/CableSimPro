// The gallery (/gallery): the theme, every kit part in every state, and the five screens laid out from them. A new screen
// takes its parts from here; a part that is not here does not exist. /gallery#screen=<id> opens one screen at full size.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/kit/icon';
import { AgentSection, ControlsSection, SectionTitle, ThemeSection, WorkbenchSection } from './gallery/sections';
import { SCREENS } from './gallery/screens';

const screenOf = () => new URLSearchParams(window.location.hash.slice(1)).get('screen');

const CONTENTS = [
  { id: 'screens', title: '五屏版式' },
  { id: 'theme', title: '主题' },
  { id: 'controls', title: '基础控件' },
  { id: 'agent', title: 'Agent 部件' },
  { id: 'workbench', title: '工作台部件' },
];

export function Gallery() {
  const [screen, setScreen] = useState(screenOf);
  useEffect(() => {
    const follow = () => setScreen(screenOf());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  const shown = SCREENS.find(item => item.id === screen);
  if (shown) return <div className="fixed inset-0 z-40 bg-canvas" data-screen={shown.id}>{shown.render()}</div>;
  return <div className="h-full overflow-y-auto bg-canvas">
    <div className="mx-auto grid max-w-page grid-cols-gallery gap-10 px-8 py-10">
      <nav aria-label="陈列目录" className="sticky top-10 flex flex-col gap-1 self-start">
        <h1 className="m-0 mb-3 px-3 text-h1 text-ink">陈列</h1>
        {CONTENTS.map(item => <a key={item.id} href={`#${item.id}`} onClick={event => { event.preventDefault(); document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' }); }}
          className="flex h-8 items-center rounded-nav px-3 text-sm text-ink no-underline hover:bg-hover">{item.title}</a>)}
      </nav>
      <main className="flex min-w-0 flex-col gap-8 pb-24">
        <SectionTitle id="screens" title="五屏版式" lead="用下面的部件和真实数据拼出的五屏。每屏先写一句工程师在这屏要干成哪件事；点“全屏看”按 1366 或 1920 看原尺寸。" />
        <div className="grid grid-cols-1 gap-8">
          {SCREENS.map(item => <section key={item.id} className="flex flex-col gap-3">
            <header className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="m-0 text-h2 text-ink">{item.title}</h3>
                <p className="m-0 text-sm text-ink-2">{item.job}</p>
              </div>
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={`#screen=${item.id}`} />}><Icon name="action/external" data-icon="inline-start" />全屏看</Button>
            </header>
            <div className="screen-half overflow-hidden rounded-card border border-line bg-canvas" inert>
              <div className="screen-frame origin-top-left scale-50">{item.render()}</div>
            </div>
          </section>)}
        </div>
        <SectionTitle id="theme" title="主题" lead="design/tokens.css 的白灰底加铜色，补全成 ui/styles/theme.css：颜色、字号、圆角、阴影、间距、动效，深浅两套。" />
        <ThemeSection />
        <SectionTitle id="controls" title="基础控件" lead="ui/components/ui：shadcn/ui（Base UI）的控件按主题改过。页面不直接写原生按钮、输入框、下拉和表格。" />
        <ControlsSection />
        <SectionTitle id="agent" title="Agent 部件" lead="ui/kit/chat：对话页的全部部件，每个摆出全部状态。数据取自 8210 的真实对话和运行记录。" />
        <AgentSection />
        <SectionTitle id="workbench" title="工作台部件" lead="ui/kit/workbench：工作台的外壳、页头、数据表、面板、标记和断面画布外框。" />
        <WorkbenchSection />
      </main>
    </div>
  </div>;
}

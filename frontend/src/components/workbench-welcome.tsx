import cableIllustration from '../../../design/brand/workbench-cable.webp?url';

/** Decoration only: never rendered as a model, result, or report artifact. */
export function WorkbenchWelcome() {
  return (
    <section className="wb-welcome" aria-labelledby="wb-welcome-heading">
      <div className="wb-welcome-copy">
        <span className="wb-eyebrow">CABLESIMPRO / ENGINEERING WORKSPACE</span>
        <h2 id="wb-welcome-heading">从工程定义，到有据可查的结果。</h2>
        <p>继续型号设计与研究工作。输入、方法版本和保存结果，各自保留清晰的身份。</p>
        <div className="wb-workflow" aria-label="工程流程"><span>定义型号</span><span aria-hidden="true">→</span><span>配置研究</span><span aria-hidden="true">→</span><span>复核结果</span><span aria-hidden="true">→</span><span>形成交付</span></div>
      </div>
      <figure className="wb-welcome-figure"><img src={cableIllustration} alt="" loading="lazy" /><figcaption>概念插画 · 非工程结构模型</figcaption></figure>
    </section>
  );
}

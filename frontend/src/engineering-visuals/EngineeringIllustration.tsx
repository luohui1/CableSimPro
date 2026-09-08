import {useEffect, useState} from 'react';
import {ImageOff} from 'lucide-react';
import catalog from './catalog.json';

export type IllustrationId = keyof typeof catalog.assets;

/** Shipped explanatory imagery only. Runtime field results never use this component. */
export default function EngineeringIllustration({id, compact = false, eager = false}: {
  id: IllustrationId; compact?: boolean; eager?: boolean;
}) {
  const asset = catalog.assets[id];
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  useEffect(() => setState('loading'), [id, asset.sha256]);
  const safe = /^\/engineering\/[a-z0-9-]+\.webp$/.test(asset.src);
  const fallback = !safe || state === 'fallback';
  return <figure className={`engineering-illustration ${compact ? 'is-compact' : ''}`}
    data-testid="engineering-illustration" data-asset={id}
    data-status={fallback ? 'fallback' : state} data-purpose="illustration-only">
    {fallback ? <div className="illustration-fallback" role="img" aria-label={asset.alt}>
      <ImageOff size={28}/><b>{asset.title}</b><span>说明图暂不可用，工程操作不受影响。</span>
    </div> : <img key={asset.sha256} src={asset.src} alt={asset.alt}
      width={asset.width} height={asset.height} loading={eager ? 'eager' : 'lazy'}
      decoding="async" onLoad={() => setState('ready')} onError={() => setState('fallback')}/>}
    <figcaption><span>{asset.title}</span><small>说明示意 · 非计算结果</small></figcaption>
  </figure>;
}

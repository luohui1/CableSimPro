// What a step of the agent leaves in the conversation: the proposal that waits for a decision (or was decided), and the card of what
// came out. The host sends references; each card reads what it shows.
import { Suspense, lazy } from 'react';
import type { CardRef, ChatStep } from '@shared/types';
import { CardAction, ModelCard } from '@/kit/chat/cards';
import { CheckResult } from './check';
import { CorrectionResult } from './correction';
import { FileResult } from './file';
import { useOpen } from './open';
import { ProposalBlock } from './proposal';
import { RatingTableResult } from './rating-table';
import { RunResult } from './rating';
import { StandardResult } from './standard';

// The 3D viewer brings three.js: it is fetched when a model card first appears, not with the home page.
const ModelResult = lazy(() => import('./model').then(module => ({ default: module.ModelResult })));

/** A button that takes the engineer to something the agent named, in the words the host gave it. */
function OpenResult({ card }: { card: Extract<CardRef, { kind: 'open' }> }) {
  const open = useOpen();
  return <div className="flex"><CardAction icon="action/external" onClick={() => open(card.href)}>在工作台打开 · {card.label}</CardAction></div>;
}

function ResultCard({ card, step }: { card: CardRef; step: ChatStep }) {
  switch (card.kind) {
    case 'run': return <RunResult card={card} />;
    case 'check': return <CheckResult card={card} />;
    case 'file': return <FileResult card={card} />;
    case 'model3d': return <Suspense fallback={<ModelCard title="三维结构" state="loading" />}><ModelResult card={card} subject={step.target} /></Suspense>;
    case 'open': return <OpenResult card={card} />;
    case 'rating_table': return <RatingTableResult card={card} />;
    case 'standard': return <StandardResult card={card} />;
    case 'correction': return <CorrectionResult card={card} />;
  }
}

export function StepCards({ step }: { step: ChatStep }) {
  return <>
    {step.proposal && <ProposalBlock proposal={step.proposal} step={step} />}
    {step.card && step.status === 'done' && <ResultCard card={step.card} step={step} />}
  </>;
}

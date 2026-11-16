// Shared by the host tests: a scripted model the agent can talk to, and small helpers to follow what it does.
import assert from 'node:assert/strict';
import { fauxProvider, InMemoryCredentialStore, type TranscriptContext } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ModelConfig } from '../host/agent.ts';
import type { App } from '../host/server.ts';
import type { ChatStep, ChatView, StudioEvent } from '../shared/types.ts';

/** A model that answers from a script, wired the way the host wires a real one. */
export async function scriptedModel() {
  const faux = fauxProvider();
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  models.registerNativeProvider(faux.provider);
  const runtime: ModelConfig = { models, model: faux.getModel(), provider: 'scripted', thinking: 'off' };
  return { faux, runtime };
}

export function next<E extends StudioEvent['type']>(app: App, type: E, match: (event: Extract<StudioEvent, { type: E }>) => boolean) {
  return new Promise<Extract<StudioEvent, { type: E }>>(done => {
    const listen = (event: StudioEvent) => {
      if (event.type === type && match(event as Extract<StudioEvent, { type: E }>)) {
        app.studio.events.off('event', listen);
        done(event as Extract<StudioEvent, { type: E }>);
      }
    };
    app.studio.events.on('event', listen);
  });
}

/** The result the model has just been given for its last tool call. */
export const toolText = (context: TranscriptContext): string => {
  const last = context.messages.at(-1)!;
  assert.equal(last.role, 'toolResult');
  return (last as { content: { text: string }[] }).content[0].text;
};
export const toolResult = (context: TranscriptContext) => JSON.parse(toolText(context));

export const steps = (view: ChatView): ChatStep[] => view.items.flatMap(item => item.parts).filter((part): part is ChatStep => part.type === 'step');
export const lastText = (view: ChatView): string => {
  const part = view.items.at(-1)?.parts.findLast(item => item.type === 'text');
  return part?.type === 'text' ? part.text : '';
};

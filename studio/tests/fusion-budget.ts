// A context-limited test provider. Its decisions are scripted, but its inputs are the actual pi transcript, including
// the system prompt, tool schemas and every previous turn. Unlike an ordinary faux provider, it refuses an oversized request.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createProvider, InMemoryCredentialStore, type TranscriptContext } from '@earendil-works/pi-ai';
import { createFauxCore } from '@earendil-works/pi-ai/providers/faux';
import { getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai/utils/transcript';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ModelConfig } from '../fusion/pi.ts';

export const CONTEXT_TOKENS = 64_000;
// Match the production bridge's declared maximum answer, not just the short replies the scripted model happens to produce.
export const OUTPUT_TOKENS = 16_384;

export interface ContextMeasurement {
  phase: string;
  messages: number;
  systemBytes: number;
  toolSchemaBytes: number;
  historyBytes: number;
  tokenizers: Record<string, number>;
  inputTokens: number;
  reservedOutput: number;
  totalTokens: number;
}

/** Both are real tokenizers, not chars/4. Taking the larger count plus framing is a reproducible 64k-budget regression;
 * it is not a claim to have used GLM's private tokenizer or to replace the maintainer's real-model acceptance.
 * tiktoken comes from the declared backend test dependencies; no model service or credentials are used. */
export function tokenCounts(text: string): Record<string, number> {
  const output = execFileSync(process.env.CABLE_STUDIO_PYTHON ?? 'python', ['-X', 'utf8', '-c',
    "import json,sys,tiktoken; text=sys.stdin.read(); print(json.dumps({name:len(tiktoken.get_encoding(name).encode(text,disallowed_special=())) for name in ('cl100k_base','o200k_base')}))"],
  { input: text, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_024 });
  return JSON.parse(output);
}

/** Include the actual system sections, all tool schemas and cumulative conversation content at the provider boundary.
 * Details are session/card metadata, not model input; the tool's entire content IS counted. Tokenize the complete serialization,
 * rather than just the most recent result, and add allowance for provider framing plus a separately reserved answer. */
export function measureContext(context: TranscriptContext, phase: string): ContextMeasurement {
  const system = getCurrentSystemPrompt(context.messages);
  const tools = getCurrentTools(context.messages);
  const messages = context.messages.filter(message => message.role !== 'system').map(message => {
    if (message.role === 'toolResult') return { role: message.role, toolCallId: message.toolCallId, toolName: message.toolName, content: message.content };
    return { role: message.role, content: message.content };
  });
  const systemBytes = Buffer.byteLength(system, 'utf8');
  const toolSchemaBytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
  const historyBytes = Buffer.byteLength(JSON.stringify(messages), 'utf8');
  const framing = 1_024 + context.messages.length * 16 + tools.length * 32;
  const tokenizers = tokenCounts(JSON.stringify({ system, tools, messages }));
  const inputTokens = Math.max(...Object.values(tokenizers)) + framing;
  return { phase, messages: messages.length, systemBytes, toolSchemaBytes, historyBytes,
    tokenizers, inputTokens, reservedOutput: OUTPUT_TOKENS, totalTokens: inputTokens + OUTPUT_TOKENS };
}

export async function budgetedModel() {
  const core = createFauxCore({ models: [{ id: 'bounded-64k', contextWindow: CONTEXT_TOKENS, maxTokens: OUTPUT_TOKENS, input: ['text'] }] });
  const requests: ContextMeasurement[] = [];
  const toolResults = new Map<string, { tool: string; characters: number; text: string }>();
  let phase = 'not-started';
  const check: typeof core.stream = (model, context, options) => {
    const measurement = measureContext(context, phase);
    requests.push(measurement);
    for (const message of context.messages) if (message.role === 'toolResult') {
      assert.ok(message.content.every(part => part.type === 'text'), 'these six workflows must not send binary attachments to the model');
      const text = message.content.map(part => part.type === 'text' ? part.text : '').join('\n');
      toolResults.set(message.toolCallId, { tool: message.toolName, characters: text.length, text });
    }
    assert.equal(model.contextWindow, CONTEXT_TOKENS);
    assert.equal(model.maxTokens, OUTPUT_TOKENS);
    assert.ok(measurement.totalTokens <= CONTEXT_TOKENS,
      `CONTEXT_BUDGET_EXCEEDED: ${JSON.stringify(measurement)}; limit=${CONTEXT_TOKENS}`);
    return core.stream(model, context, options);
  };
  const provider = createProvider({ id: core.provider,
    auth: { apiKey: { name: 'isolated context-budget test', resolve: async () => ({ auth: {} }) } },
    models: core.models, api: { stream: check, streamSimple: check } });
  const faux = { provider, api: core.api, models: core.models, getModel: core.getModel, state: core.state,
    setResponses: core.setResponses, appendResponses: core.appendResponses, getPendingResponseCount: core.getPendingResponseCount };
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  models.registerNativeProvider(provider);
  const runtime: ModelConfig = { models, model: core.getModel(), provider: 'scripted-with-context-budget', thinking: 'off' };
  return { faux, runtime, requests, toolResults, phase(name: string) { phase = name; } };
}

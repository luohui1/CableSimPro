// Exercise pi's production OpenAI serializer with the complete request that would cross the model boundary. Only the
// upstream answer is scripted: the platform, tools, approvals, saved inputs and results remain real in fusion-integration.
import assert from 'node:assert/strict';
import { createProvider, fauxAssistantMessage, fauxProvider, fauxText, InMemoryCredentialStore, type AssistantMessage, type Model,
  type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { Tiktoken } from 'js-tiktoken/lite';
import cl100kBase from 'js-tiktoken/ranks/cl100k_base';
import o200kBase from 'js-tiktoken/ranks/o200k_base';
import type { ModelConfig } from '../fusion/pi.ts';

export const CONTEXT_TOKENS = 64_000;
export const OUTPUT_TOKENS = 16_384;
const encodings = { cl100k_base: new Tiktoken(cl100kBase), o200k_base: new Tiktoken(o200kBase) };
const tokenCounts = (text: string) => Object.fromEntries(Object.entries(encodings)
  .map(([name, encoding]) => [name, encoding.encode(text, [], []).length]));
const countTokens = (text: string) => Math.max(...Object.values(tokenCounts(text)));

interface WireMessage {
  role: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
}
interface WireRequest {
  messages: WireMessage[];
  tools?: unknown[];
  max_tokens?: number;
  max_completion_tokens?: number;
  [key: string]: unknown;
}
export interface RequestBudget {
  flow: string;
  request: number;
  kind: 'conversation' | 'compaction';
  logicalUserTurns: number;
  utf8Bytes: number;
  encodedTokens: number;
  tokenizers: Record<string, number>;
  framingReserve: number;
  inputTokens: number;
  outputTokens: number;
  reservedOutputTokens: number;
  totalTokens: number;
  messages: number;
  userMessages: number;
  tools: number;
  lastTool?: string;
  largestToolResultChars: number;
  largestToolResultBytes: number;
  sdkEstimate?: ReturnType<typeof estimateContextTokens>;
  reportedInputTokens?: number;
  injectedLength?: boolean;
}

export interface NativeSummary {
  request: number;
  flow: string;
  text: string;
  state: Record<string, any>;
  promptCharacters: number;
  stateBlockCharacters: number;
  stateBlockBytes: number;
  stateBlockTokens: number;
  summaryTokens: number;
}

const contentText = (content: unknown): string => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map(part => part && typeof part === 'object' && 'text' in part ? String(part.text) : '').join('\n') : '';

/** This is the only scripted part of compaction: the upstream model's answer. Pi prepares the real summary request,
 * writes the checkpoint, chooses kept entries and resumes the agent. Extract solely from the bytes supplied to that model. */
function summarizeNativeRequest(payload: WireRequest): Omit<NativeSummary, 'flow' | 'request'> {
  const prompt = payload.messages.filter(message => message.role === 'user').map(message => contentText(message.content)).join('\n');
  const blocks = [...prompt.matchAll(/<cablesim-state>\s*([\s\S]*?)\s*<\/cablesim-state>/g)];
  assert.ok(blocks.length, 'native compaction must supply its real extracted business checkpoint to the summarizer');
  const state = JSON.parse(blocks.at(-1)![1]) as Record<string, any>;
  assert.equal(state.version, 1);
  const select = (value: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter(key => key in value).map(key => [key, value[key]]));
  const receipts = (state.accepted_receipts ?? []).map((entry: any) => ({ tool: entry.tool,
    receipt: select(entry.receipt ?? {}, ['kind', 'status', 'executed', 'complete', 'run_id', 'study_id', 'type_id',
      'series_id', 'preview_id', 'batch_id', 'created', 'row_count', 'error_count', 'incomplete_count', 'engineering_approval']) }));
  const goals = [state.goals?.original, state.goals?.current].filter((goal: unknown) => typeof goal === 'string');
  const text = `## Goal\n${goals.slice(-2).join('\n')}\n\n## Constraints & Preferences\n`
    + '审批状态以保存记录为准；接受操作不等于工程审核通过。\n\n## Progress\n### Done\n'
    + JSON.stringify(receipts) + '\n### In Progress\n' + JSON.stringify(state.pending_proposals ?? [])
    + '\n### Blocked\n请保留状态附录中的缺项、错误与范围限制。\n\n## Key Decisions\n'
    + JSON.stringify(state.decision_counts ?? {}) + '\n\n## Next Steps\n继续当前问题；对尚待审阅的写操作先等待决定，不重放已执行操作。'
    + '\n\n## Critical Context\n' + JSON.stringify(state.current_object ?? null);
  for (const id of text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])
    assert.ok(prompt.includes(id), 'the scripted summary cannot inject an identity absent from its actual native prompt');
  const stateBlock = blocks.at(-1)![0];
  return { text, state, promptCharacters: prompt.length, stateBlockCharacters: stateBlock.length,
    stateBlockBytes: Buffer.byteLength(stateBlock), stateBlockTokens: countTokens(stateBlock),
    summaryTokens: countTokens(text) };
}

function toolResults(payload: WireRequest): { tool: string; id: string; text: string }[] {
  const calls = new Map(payload.messages.flatMap(message =>
    (message.tool_calls ?? []).map(call => [call.id, call.function.name] as const)));
  return payload.messages.filter(message => message.role === 'tool').map(message => {
    assert.equal(typeof message.content, 'string', 'this text-only workflow must reach the adapter as actual text');
    assert.ok(message.tool_call_id && calls.has(message.tool_call_id), 'every model result must match an actual tool call');
    return { tool: calls.get(message.tool_call_id!)!, id: message.tool_call_id!, text: message.content as string };
  });
}

/** Take the larger cl100k_base/o200k_base count, without claiming either is the maintainer's GLM tokenizer. Encoding the complete JSON
 * (including role names, tool schemas and arguments), plus framing reserves, deliberately exceeds counting visible prose alone.
 * No character/4 estimate or cached-token discount is used. The advertised 64k includes the full 16384-token output allowance. */
function measure(payload: WireRequest, flow: string, request: number, logicalUserTurns = 0): RequestBudget {
  const serialized = JSON.stringify(payload);
  const tokenizers = tokenCounts(serialized);
  const encodedTokens = Math.max(...Object.values(tokenizers));
  const tools = payload.tools ?? [];
  const framingReserve = 1_024 + 16 * payload.messages.length + 64 * tools.length;
  const results = toolResults(payload);
  const inputTokens = encodedTokens + framingReserve;
  const outputTokens = Number(payload.max_completion_tokens ?? payload.max_tokens ?? 0);
  const kind = tools.length ? 'conversation' : 'compaction';
  return { flow, request, kind, logicalUserTurns, utf8Bytes: Buffer.byteLength(serialized, 'utf8'), encodedTokens, tokenizers, framingReserve,
    inputTokens, outputTokens, reservedOutputTokens: OUTPUT_TOKENS, totalTokens: inputTokens + OUTPUT_TOKENS, messages: payload.messages.length,
    userMessages: payload.messages.filter(message => message.role === 'user').length,
    tools: tools.length, lastTool: results.at(-1)?.tool,
    largestToolResultChars: Math.max(0, ...results.map(result => result.text.length)),
    largestToolResultBytes: Math.max(0, ...results.map(result => Buffer.byteLength(result.text))) };
}

function sse(message: AssistantMessage, model: string, budget: RequestBudget): Response {
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    return Response.json({ error: { message: message.errorMessage ?? 'Scripted model failed', type: 'test_model_error' } }, { status: 400 });
  }
  const toolCalls = message.content.filter(part => part.type === 'toolCall');
  const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('');
  const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null, usage?: Record<string, number>) =>
    'data: ' + JSON.stringify({ id: 'budget-response', object: 'chat.completion.chunk', model,
      choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) }) + '\n\n';
  const content = chunk({ role: 'assistant', ...(text ? { content: text } : {}),
    ...(toolCalls.length ? { tool_calls: toolCalls.map((call, index) => ({ index, id: call.id, type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) });
  const completionTokens = countTokens(JSON.stringify(message.content));
  assert.ok(completionTokens <= budget.outputTokens, 'the scripted answer itself must fit the actual upstream output allowance');
  // Report the reproducible tokenizer measurement as provider usage. The gate's extra framing allowance is not consumed
  // tokens: feeding that reserve back as usage would make pi deduct its own safety margin from a fictitiously larger input.
  assert.ok(budget.framingReserve > 0);
  assert.equal(budget.inputTokens, budget.encodedTokens + budget.framingReserve);
  budget.reportedInputTokens = budget.encodedTokens;
  return new Response(content + chunk({}, message.stopReason === 'length' ? 'length' : toolCalls.length ? 'tool_calls' : 'stop', {
    prompt_tokens: budget.reportedInputTokens, completion_tokens: completionTokens,
    total_tokens: budget.reportedInputTokens + completionTokens,
  }) + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

export async function budgetedModel() {
  const faux = fauxProvider({ models: [{ id: 'budget-script', contextWindow: CONTEXT_TOKENS, maxTokens: OUTPUT_TOKENS }] });
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  const adapter = openAICompletionsApi();
  const model: Model<'openai-completions'> = { id: 'budgeted-openai-compatible', name: '64k integration budget',
    api: 'openai-completions', provider: 'fusion-budget', baseUrl: 'http://model.invalid/v1', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: CONTEXT_TOKENS, maxTokens: OUTPUT_TOKENS };
  const requests: RequestBudget[] = [];
  const toolInputs = new Map<string, { tool: string; text: string }>();
  const firstToolInputs = new Map<string, { tool: string; text: string }>();
  const afterTool = new Map<string, WireRequest>();
  const violations: RequestBudget[] = [];
  const nativeSummaries: NativeSummary[] = [];
  let lastWire: WireRequest | undefined;
  let flow = 'not-started';
  let logicalUserTurns = 0;
  let lengthAfter: string | undefined;

  const stream = (selected: Model<any>, context: TranscriptContext, options?: SimpleStreamOptions) =>
    adapter.streamSimple(selected, context, { ...options, apiKey: 'local-budget-placeholder', maxRetries: 0,
      maxTokens: options?.maxTokens ?? OUTPUT_TOKENS, fetch: async (_request, init) => {
        const body = init?.body;
        assert.equal(typeof body, 'string', 'inspect the production adapter serialized body, not an invented request');
        const payload = JSON.parse(body as string) as WireRequest;
        lastWire = payload;
        assert.ok(payload.messages.some(message => message.role === 'system' || message.role === 'developer'), 'count the system prompt');
        const summarizing = payload.messages.some(message => (message.role === 'system' || message.role === 'developer')
          && contentText(message.content).includes('You are a context summarization assistant.'));
        if (summarizing) {
          assert.equal(payload.tools?.length ?? 0, 0, 'pi native summarization has no business tools');
          assert.equal(payload.messages.filter(message => message.role === 'user').length, 1);
        } else assert.ok(Array.isArray(payload.tools) && payload.tools.length > 20, 'count the full active tool schema catalogue');
        const budget: RequestBudget = { ...measure(payload, flow, requests.length + 1, logicalUserTurns), sdkEstimate: estimateContextTokens(context) };
        requests.push(budget);
        for (const result of toolResults(payload)) {
          if (!firstToolInputs.has(result.id)) firstToolInputs.set(result.id, { tool: result.tool, text: result.text });
          toolInputs.set(result.id, { tool: result.tool, text: result.text });
          if (payload.messages.at(-1)?.tool_call_id === result.id) afterTool.set(result.tool, structuredClone(payload));
        }
        const expectedOutput = summarizing ? options?.maxTokens ?? selected.maxTokens : OUTPUT_TOKENS;
        if (budget.totalTokens > CONTEXT_TOKENS || budget.outputTokens !== expectedOutput) {
          violations.push(budget);
          return Response.json({ error: { type: 'context_length_exceeded',
            message: `64k budget rejected: input ${budget.inputTokens}, output ${budget.outputTokens}; ${OUTPUT_TOKENS} output tokens must remain` } }, { status: 400 });
        }
        if (summarizing) {
          const result = summarizeNativeRequest(payload);
          nativeSummaries.push({ request: budget.request, flow, ...result });
          return sse(fauxAssistantMessage([fauxText(result.text)]), selected.id, budget);
        }
        if (lengthAfter && budget.lastTool === lengthAfter) {
          lengthAfter = undefined;
          budget.injectedLength = true;
          // Leave the business response queue untouched. Native recovery must compact the real context and continue exactly once.
          return sse(fauxAssistantMessage([fauxText('回复在完成前达到长度限制。')], { stopReason: 'length' }), selected.id, budget);
        }
        const reply = await faux.provider.streamSimple(faux.getModel(), context, options).result();
        return sse(reply, selected.id, budget);
      } });

  models.registerNativeProvider(createProvider({ id: model.provider, name: 'Budgeted test model', baseUrl: model.baseUrl,
    auth: faux.provider.auth, models: [model], api: { stream, streamSimple: stream } }));
  const runtime: ModelConfig = { models, model, provider: 'budgeted-test', thinking: 'off' };
  return { faux, runtime, requests, violations, toolInputs, firstToolInputs, nativeSummaries,
    lastRequest: () => structuredClone(lastWire),
    flow: (name: string) => { flow = name; logicalUserTurns += 1; },
    injectLengthOnceAfter: (tool: string) => { assert.equal(lengthAfter, undefined); lengthAfter = tool; },
    /** Counterfactual with the original real result restored in the same serialized request. This must fail for the large
     * comparison that motivated the regression; a test with a conveniently small synthetic fixture would not detect it. */
    withUnboundedResult: (tool: string, value: unknown) => {
      const actual = afterTool.get(tool);
      assert.ok(actual, 'the workflow must have requested another model response after ' + tool);
      const payload = structuredClone(actual);
      payload.messages.at(-1)!.content = JSON.stringify(value);
      return measure(payload, 'unbounded-' + tool, 0);
    },
  };
}

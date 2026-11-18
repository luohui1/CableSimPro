// All model requests use the platform's proxy. The platform selects its saved settings or the Cable Studio environment fallback;
// the sidecar receives only a model name and a provider label, never the model key.
import { clampThinkingLevel, createProvider, envApiKeyAuth, InMemoryCredentialStore, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { AgentStatus } from '../shared/types.ts';
import type { Backend, BackendModel } from './backend.ts';
import { BackendError } from './backend.ts';
import { pi, type ModelConfig } from './pi.ts';

export const TOKEN_VARIABLE = 'CABLESIM_AGENT_SIDECAR_TOKEN';
export const NOT_CONFIGURED = '还没有配置 AI 模型：在“设置 · AI 模型”里填写服务地址、模型名和密钥后即可使用。';

const thinking = (): ThinkingLevel => (process.env.CABLE_STUDIO_MODEL_THINKING as ThinkingLevel | undefined) ?? 'off';

/** Older backends have no budget fields. Never infer a larger window from a provider catalogue. */
export function modelBudget(settings: Pick<BackendModel, 'context_window' | 'max_output_tokens'>) {
  const contextWindow = settings.context_window ?? 64000;
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 16384 || contextWindow > 2_000_000)
    throw new BackendError('MODEL_BUDGET_INVALID', '模型上下文窗口设置无效；请在模型设置中填写有效的 token 数。', 422);
  const fallbackOutput = Math.min(16384, contextWindow - 8192);
  const maxTokens = settings.max_output_tokens ?? fallbackOutput;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 256 || maxTokens > Math.min(131072, contextWindow - 8192))
    throw new BackendError('MODEL_BUDGET_INVALID', '模型最大输出设置无效；请在模型设置中为输入保留足够上下文。', 422);
  return { contextWindow, maxTokens };
}

/** What the page is told about the model: reachable and configured, or the reason it cannot work. */
export async function agentStatus(backend: Backend): Promise<AgentStatus> {
  try {
    const held = await backend.model();
    if (held.configured && held.model) return { configured: true, model: held.model, provider: held.provider ?? undefined };
  } catch (error) {
    if (error instanceof BackendError && error.code === 'BACKEND_UNREACHABLE') return { configured: false, hint: error.message };
    if (!(error instanceof BackendError)) throw error;
    return { configured: false, hint: error.message };
  }
  return { configured: false, hint: NOT_CONFIGURED };
}

/** The model for a conversation comes only from the platform's resolved configuration and always uses its credential proxy. */
export async function resolveModel(backend: Backend): Promise<ModelConfig | null> {
  let held: BackendModel | undefined;
  try {
    held = await backend.model();
  } catch (error) {
    if (!(error instanceof BackendError)) throw error;
  }
  if (held?.configured && held.model) {
    const { ModelRuntime } = await pi();
    const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
    const baseUrl = `${backend.url}/internal/llm/v1`;
    // pi detects provider-specific wire protocols from provider/baseUrl. Those
    // now name our credential proxy, so that detection cannot see Z.AI anymore.
    // Keep the pinned catalogue's exact GLM protocol (including supported
    // thinking levels), but never its address, credentials or context budget.
    const native = /^glm-/i.test(held.model) ? models.getModel('zai', held.model) : undefined;
    const protocol = native?.api === 'openai-completions' ? native : undefined;
    const model: Model<'openai-completions'> = {
      id: held.model, name: held.model, api: 'openai-completions', provider: 'cablesim-backend', baseUrl, reasoning: protocol?.reasoning ?? thinking() !== 'off', input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ...modelBudget(held),
      ...(protocol ? { compat: protocol.compat, thinkingLevelMap: protocol.thinkingLevelMap } : {}),
    };
    models.registerNativeProvider(createProvider({
      id: 'cablesim-backend', name: '老后端的模型设置', baseUrl, auth: { apiKey: envApiKeyAuth('边车令牌', [TOKEN_VARIABLE]) }, models: [model], api: openAICompletionsApi(),
    }));
    return { models, model, provider: held.provider ?? 'CableSimPro', thinking: clampThinkingLevel(model, thinking()) };
  }
  return null;
}

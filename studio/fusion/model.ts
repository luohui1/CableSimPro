// Which model the Agent talks to. The platform's own settings come first: its model requests go to the platform's proxy, which adds
// the key, so this process never holds the key. When the platform has no model configured, the Cable Studio variables are the
// fallback (the key is then the engineer's own environment variable, read the way Cable Studio reads it).
import { createProvider, envApiKeyAuth, InMemoryCredentialStore, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { AgentStatus } from '../shared/types.ts';
import { modelFromEnvironment, modelIdentity, type ModelConfig } from '../host/agent.ts';
import type { Backend, BackendModel } from './backend.ts';
import { BackendError } from './backend.ts';
import { pi } from './pi.ts';

export const TOKEN_VARIABLE = 'CABLESIM_AGENT_SIDECAR_TOKEN';
export const NOT_CONFIGURED = '还没有配置 AI 模型：在“设置 · AI 模型”里填写服务地址、模型名和密钥后即可使用。';

const thinking = (): ThinkingLevel => (process.env.CABLE_STUDIO_MODEL_THINKING as ThinkingLevel | undefined) ?? 'off';

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
  const own = modelIdentity();
  return own ? { configured: true, model: own.model, provider: own.provider } : { configured: false, hint: NOT_CONFIGURED };
}

/** The model for a conversation: through the platform's proxy when it holds one, else from this process's environment, else none. */
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
    const model: Model<'openai-completions'> = {
      id: held.model, name: held.model, api: 'openai-completions', provider: 'cablesim-backend', baseUrl, reasoning: thinking() !== 'off', input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384,
    };
    models.registerNativeProvider(createProvider({
      id: 'cablesim-backend', name: '老后端的模型设置', baseUrl, auth: { apiKey: envApiKeyAuth('边车令牌', [TOKEN_VARIABLE]) }, models: [model], api: openAICompletionsApi(),
    }));
    return { models, model, provider: held.provider ?? 'CableSimPro', thinking: thinking() };
  }
  return modelFromEnvironment();
}

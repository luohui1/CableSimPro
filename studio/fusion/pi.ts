// pi's session layer takes a few seconds to load, so the sidecar starts without it and the first conversation pays once.
// Install telemetry and catalogue downloads are off: the only network traffic is the model the platform holds.
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export interface ModelConfig { models: ModelRuntime; model: Model<any>; provider: string; thinking: ThinkingLevel }

/** pi may describe skills by filename, but a model only needs their stable names. */
export function noPaths(prompt: string): string {
  return prompt.replace(/\n*<cwd>[\s\S]*?<\/cwd>\n*/, '\n')
    .replace(/(<name>([^<]+)<\/name>[\s\S]*?<location>)[^<]*(<\/location>)/g, '$1$2$3')
    .replace('Use absolute paths in tool calls.', 'Call the read tool with the skill name.');
}

let loaded: Promise<typeof import('@earendil-works/pi-coding-agent')> | undefined;

export function pi() {
  process.env.PI_TELEMETRY ??= '0';
  process.env.PI_OFFLINE ??= '1';
  return (loaded ??= import('@earendil-works/pi-coding-agent'));
}

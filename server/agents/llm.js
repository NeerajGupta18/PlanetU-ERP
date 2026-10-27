/**
 * The ONE place the server talks to a language model.
 *
 * Every provider is reached through the OpenAI-compatible chat-completions format with tool calling, so changing
 * provider or model is only a change of environment variables:
 *   office assistants:  AGENT_LLM_PROVIDER, AGENT_LLM_MODEL, AGENT_LLM_API_KEY
 *   public help chat:   PUBLIC_LLM_PROVIDER, PUBLIC_LLM_MODEL, PUBLIC_LLM_API_KEY
 *
 * No key -> not connected (the assistants say so; nothing else in the ERP changes). A rate-limit answer (429)
 * becomes LlmError('busy') and is never retried here. Under `node --test` the real API is never called: a test
 * must install a stub with useStubModel(), otherwise the model is "not connected".
 */
import { env } from '../src/config/env.js';

// Checked against the providers' own docs (Groq tool use and OpenAI compatibility pages; Google's Gemini
// OpenAI compatibility page): both accept `tools` on /chat/completions. gpt-oss models on Groq support tool use
// but not parallel tool calls, so the runner handles one call at a time.
export const PROVIDERS = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash' },
};

export class LlmError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const BUSY_MESSAGE = 'The assistant is busy, try again in a minute.';
export const NOT_CONNECTED_MESSAGE = 'Not connected. The assistant needs a model key, which the institute\'s technical person adds on the server.';

let stub = null;
/** Tests only: answer every chat() with fn({ messages, tools, channel }) instead of calling a provider. null removes it. */
export function useStubModel(fn) { stub = fn; }

const underTest = () => Boolean(process.env.NODE_TEST_CONTEXT);

function settings(channel) {
  const pub = channel === 'public';
  const provider = (pub ? env.PUBLIC_LLM_PROVIDER : env.AGENT_LLM_PROVIDER).toLowerCase();
  const p = PROVIDERS[provider];
  const key = pub ? env.PUBLIC_LLM_API_KEY : env.AGENT_LLM_API_KEY;
  const model = (pub ? env.PUBLIC_LLM_MODEL : env.AGENT_LLM_MODEL) || p?.model || '';
  return { provider, model, key, baseUrl: p?.baseUrl, known: Boolean(p) };
}

/** What the status line shows. Never includes the key. */
export function llmStatus(channel = 'agent') {
  if (stub) return { connected: true, provider: 'stub', model: 'stub' };
  const s = settings(channel);
  return { connected: !underTest() && s.known && Boolean(s.key), provider: s.provider, model: s.model };
}

/**
 * One chat-completions call. Returns { message: { content, tool_calls }, usage: { prompt, completion }, model }.
 * Throws LlmError: 'not_connected' | 'busy' (429) | 'failed'.
 */
export async function chat({ channel = 'agent', messages, tools, maxTokens = 800 }) {
  if (stub) {
    const out = await stub({ messages, tools, channel });
    return { message: { content: out.content ?? null, tool_calls: out.tool_calls || [] }, usage: { prompt: out.usage?.prompt ?? 50, completion: out.usage?.completion ?? 20 }, model: 'stub' };
  }
  if (!llmStatus(channel).connected) throw new LlmError('not_connected', NOT_CONNECTED_MESSAGE);
  const s = settings(channel);
  const body = { model: s.model, messages, temperature: 0.2, max_tokens: maxTokens };
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }
  if (s.provider === 'groq' && s.model.includes('gpt-oss')) body.reasoning_effort = 'low'; // short thinking, fewer tokens

  let res;
  try {
    res = await fetch(`${s.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new LlmError('failed', 'Could not reach the assistant. Check the internet connection and try again.');
  }
  if (res.status === 429) throw new LlmError('busy', BUSY_MESSAGE);
  if (res.status === 401 || res.status === 403) throw new LlmError('not_connected', 'Not connected. The model key was refused; ask the technical person to check it.');
  if (!res.ok) throw new LlmError('failed', 'The assistant could not answer just now. Try again in a minute.');
  const data = await res.json().catch(() => null);
  const choice = data?.choices?.[0]?.message;
  if (!choice) throw new LlmError('failed', 'The assistant gave an empty answer. Try again.');
  return {
    message: { content: choice.content ?? null, tool_calls: Array.isArray(choice.tool_calls) ? choice.tool_calls : [] },
    usage: { prompt: Number(data.usage?.prompt_tokens) || 0, completion: Number(data.usage?.completion_tokens) || 0 },
    model: s.model,
  };
}

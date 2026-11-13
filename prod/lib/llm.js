/**
 * 《三宝殿》生产系统 · 可配置真实大模型接入（LLM 适配层 v2.0）
 *
 * 职责：OpenAI-compatible Chat Completions 真实调用 + 强制降级到领域规则兜底。
 *
 * 红线（严格执行，不得放宽）：
 *   1. 所有返回对象恒含 model_decision: null —— 模型绝不决定推送名单、结算、争议裁定、处罚。
 *   2. 送模型前必须 sanitizeSubmissionText 脱敏 + 截断；绝不把原始正文 / 联系方式外发。
 *   3. 不得把模型输出写入事件 payload 或日志；不得记录 API Key / Bearer 头 / purpose 明细。
 *   4. 任何异常 / 非 2xx / 超时一律吞掉并降级，绝不抛到编排层。
 *
 * 降级策略：未配置 LLM_API_URL + LLM_API_KEY，或调用失败 → degraded:true + 领域规则兜底结果。
 */

import {
  sanitizeSubmissionText,
  extractTaskStructure,
  semanticMatchHint,
  summarizeDispute,
} from './domain.js';

const MODEL_TIMEOUT_MS = 4000;
const MAX_INPUT = 800;
const MAX_OUTPUT = 2000;

/** 送模型前的统一脱敏：对象转 JSON 文本，抹除 PII，截断 800 字符 */
function maskForModel(value) {
  let raw;
  try {
    raw = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  } catch {
    raw = '';
  }
  return sanitizeSubmissionText(raw).text.slice(0, MAX_INPUT);
}

/** 模型文本若声称是 JSON 对象则解析，否则返回 null（回退到规则兜底，不伪造结构） */
function safeParseObject(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function llmMeta(env) {
  const configured = Boolean(env && env.LLM_API_URL && env.LLM_API_KEY);
  return {
    configured,
    degraded: !configured,
    provider: (env && env.LLM_PROVIDER) || 'openai-compatible',
    model: (env && env.LLM_MODEL) || 'gpt-4o-mini',
    version: 'llm-adapter-v2.0',
    model_decision: null,
  };
}

export async function callModel(env, { system, user, purpose }) {
  // purpose 仅表示调用用途，不外发、不记录、不参与任何决策
  void purpose;
  const meta = llmMeta(env);
  if (!meta.configured) return { degraded: true, text: null, model_decision: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const resp = await fetch(String(env.LLM_API_URL), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: meta.model,
        messages: [
          { role: 'system', content: String(system ?? '') },
          { role: 'user', content: maskForModel(user) },
        ],
        temperature: 0,
        max_tokens: 400,
      }),
      signal: controller.signal,
    });
    if (!resp || !resp.ok) return { degraded: true, text: null, model_decision: null };
    const json = await resp.json();
    const text = String(json?.choices?.[0]?.message?.content ?? '').slice(0, MAX_OUTPUT);
    return { degraded: false, text, model_decision: null };
  } catch {
    // 吞掉一切异常：网络 / 超时 / 非法 JSON / 缺字段，绝不抛到编排层
    return { degraded: true, text: null, model_decision: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function extractStructure(env, { title, description }) {
  const user = maskForModel(`${String(title ?? '')}\n${String(description ?? '')}`);
  const result = await callModel(env, {
    system: '你是任务结构化助手。只输出描述任务结构的 JSON 对象；不做任何决策、裁定或评分。',
    user,
    purpose: 'extract_structure',
  });
  // domain 的真实签名为 extractTaskStructure(task)（单对象），此处按真实签名调用
  const fallback = extractTaskStructure({ title, description });
  const structure = result.degraded
    ? fallback
    : (safeParseObject(result.text) || { text: result.text, model_decision: null });
  return { structure, degraded: result.degraded, model_decision: null };
}

export async function semanticHint(env, { task, candidate }) {
  const result = await callModel(env, {
    system: '你是语义匹配助手。只输出匹配提示文本；绝不产出推送名单或人员决策。',
    user: { task: maskForModel(task), candidate: maskForModel(candidate) },
    purpose: 'semantic_hint',
  });
  // domain 的真实签名为 semanticMatchHint(task, user)（双对象）
  const hint = result.degraded
    ? semanticMatchHint(task, candidate)
    : { text: result.text, source: 'model', model_decision: null };
  return { hint, degraded: result.degraded, model_decision: null };
}

export async function disputeSummary(env, { materials }) {
  const result = await callModel(env, {
    system: '你是争议材料摘要助手。只做事实摘要，绝不产出裁定结论或处罚建议。',
    user: maskForModel(materials),
    purpose: 'dispute_summary',
  });
  const disputeArg = materials && typeof materials === 'object' && !Array.isArray(materials)
    ? materials
    : {};
  // domain 的真实签名为 summarizeDispute(dispute)（单对象）
  const summary = result.degraded
    ? summarizeDispute(disputeArg)
    : { text: result.text, source: 'model', decision: null, model_decision: null };
  return { summary, degraded: result.degraded, model_decision: null };
}

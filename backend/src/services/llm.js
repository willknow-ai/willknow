import fetch from 'node-fetch'
import { callSubAgent } from './subagent.js'

const MAX_TURNS = 10

// ─── Skills: read_skill tool (progressive disclosure) ────────────────────────

const READ_SKILL_TOOL = {
  name: 'read_skill',
  description: "Read the full instructions for an available skill. Call this when you determine a user task matches a skill's description.",
  input_schema: {
    type: 'object',
    properties: {
      skill_name: {
        type: 'string',
        description: 'The name of the skill to read (must match a name in <available_skills>)',
      },
    },
    required: ['skill_name'],
  },
}

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Build system prompt with skill metadata only (progressive disclosure step 1).
 * Returns null if no skills are enabled.
 */
function buildSystemPrompt(skills) {
  if (!skills || skills.length === 0) return null
  const items = skills.map(s =>
    `  <skill>\n    <name>${xmlEscape(s.name)}</name>\n    <description>${xmlEscape(s.description)}</description>\n  </skill>`
  ).join('\n')
  return [
    'You have access to the following skills that extend your capabilities.',
    "When a user task matches a skill's description, use the read_skill tool to load the full instructions before proceeding.",
    '',
    '<available_skills>',
    items,
    '</available_skills>',
  ].join('\n')
}

// ─── Main chat loop ───────────────────────────────────────────────────────────

/**
 * 主 LLM 调用服务，支持 SSE 流式输出 + SubAgent tool calling + Skills (progressive disclosure)
 *
 * @param {object}   model            - 模型配置 { provider, apiKey, baseURL, model }
 * @param {Array}    messages         - 对话历史 [{ role, content }]
 * @param {Array}    subAgentTools    - [{ subAgentId, subAgentUrl, subAgentAuth, tool }]
 * @param {object}   subAgentSessions - { subAgentId: sessionId }
 * @param {Function} onEvent         - SSE 事件回调 (type, data)
 * @param {Array}    skills           - SkillConfig[] from config
 */
export async function runChat(model, messages, subAgentTools, subAgentSessions, onEvent, skills = []) {
  const history = [...messages]
  const enabledSkills = skills.filter(s => s.enabled)

  // Tools: subAgent tools + read_skill (if any skills enabled)
  const tools = [
    ...subAgentTools.map(e => e.tool),
    ...(enabledSkills.length > 0 ? [READ_SKILL_TOOL] : []),
  ]

  // System prompt: inject skill metadata only (progressive disclosure step 1)
  const systemPrompt = buildSystemPrompt(enabledSkills)

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await callLLM(model, history, tools, onEvent, systemPrompt)

    // 将 assistant 消息追加到历史
    history.push({ role: 'assistant', content: response.content })

    // 检查是否有 tool_use
    const toolCalls = response.content.filter(b => b.type === 'tool_use')
    if (toolCalls.length === 0) break

    // 执行每个 tool call
    const toolResults = []
    for (const tc of toolCalls) {
      // ── read_skill: progressive disclosure step 2 ────────────────────────
      if (tc.name === 'read_skill') {
        const skillName = tc.input?.skill_name
        const skill = enabledSkills.find(s => s.name === skillName)
        const resultContent = skill
          ? skill.content
          : `Skill "${skillName}" not found. Available: ${enabledSkills.map(s => s.name).join(', ')}`
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: resultContent })
        continue
      }

      // ── subAgent tool ─────────────────────────────────────────────────────
      const entry = subAgentTools.find(e => e.tool.name === tc.name)
      if (!entry) {
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: 'Tool not found' })
        continue
      }

      onEvent('tool_call', { tool: tc.name, agentName: entry.tool.description.split(':')[0], input: tc.input.message })

      const sessionId = subAgentSessions[entry.subAgentId]
      try {
        const result = await callSubAgent(entry.subAgentUrl, entry.subAgentAuth, tc.input.message, sessionId)
        // 保存 session_id 供后续对话复用
        subAgentSessions[entry.subAgentId] = result.session_id
        onEvent('tool_result', { tool: tc.name, content: result.message })
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result.message })
      } catch (err) {
        const errMsg = `调用失败: ${err.message}`
        onEvent('tool_result', { tool: tc.name, content: errMsg })
        toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: errMsg })
      }
    }

    // 将 tool results 追加到历史（Anthropic 格式：user 消息携带 tool_result）
    history.push({ role: 'user', content: toolResults })
  }
}

/**
 * 调用 LLM（Anthropic 或 OpenAI-compatible），流式输出文本，返回完整 response
 */
async function callLLM(model, messages, tools, onEvent, systemPrompt) {
  if (model.provider === 'anthropic') {
    return callAnthropic(model, messages, tools, onEvent, systemPrompt)
  } else {
    return callOpenAICompatible(model, messages, tools, onEvent, systemPrompt)
  }
}

// ─── Anthropic ──────────────────────────────────────────────────────────────

async function callAnthropic(model, messages, tools, onEvent, systemPrompt) {
  const body = {
    model: model.model || 'claude-sonnet-4-6',
    max_tokens: 4096,
    stream: true,
    messages: messages.map(m => ({
      role: m.role,
      content: Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }],
    })),
  }
  if (systemPrompt) {
    body.system = systemPrompt
  }
  if (tools.length > 0) {
    body.tools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }))
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': model.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Anthropic error ${res.status}: ${err}`)
  }

  return parseAnthropicStream(res.body, onEvent)
}

/**
 * 从 node-fetch 的 body stream 中逐行读取 SSE 数据行（正确处理跨 chunk 的情况）
 */
async function* iterLines(stream) {
  let buf = ''
  for await (const chunk of stream) {
    buf += Buffer.isBuffer(chunk) ? chunk.toString() : chunk
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) yield line
  }
  if (buf) yield buf
}

async function parseAnthropicStream(stream, onEvent) {
  const content = []
  let currentText = ''
  let currentToolUse = null

  for await (const line of iterLines(stream)) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (!data || data === '[DONE]') continue

    let event
    try { event = JSON.parse(data) } catch { continue }

    if (event.type === 'content_block_start') {
      if (event.content_block.type === 'tool_use') {
        currentToolUse = { type: 'tool_use', id: event.content_block.id, name: event.content_block.name, inputRaw: '' }
      } else if (event.content_block.type === 'text') {
        currentText = ''
      }
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta
      if (delta.type === 'text_delta') {
        currentText += delta.text
        onEvent('text', { content: delta.text })
      } else if (delta.type === 'input_json_delta' && currentToolUse) {
        currentToolUse.inputRaw += delta.partial_json
      }
    } else if (event.type === 'content_block_stop') {
      if (currentToolUse) {
        try { currentToolUse.input = JSON.parse(currentToolUse.inputRaw) } catch { currentToolUse.input = {} }
        delete currentToolUse.inputRaw
        content.push(currentToolUse)
        currentToolUse = null
      } else if (currentText !== '') {
        content.push({ type: 'text', text: currentText })
        currentText = ''
      }
    }
  }

  return { content }
}

// ─── OpenAI-compatible ───────────────────────────────────────────────────────

async function callOpenAICompatible(model, messages, tools, onEvent, systemPrompt) {
  const baseURL = model.baseURL || 'https://api.openai.com/v1'

  // 转换消息格式（tool results → role: tool）
  const oaiMessages = convertMessagesToOAI(messages)

  const body = {
    model: model.model || 'gpt-4',
    stream: true,
    messages: systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...oaiMessages]
      : oaiMessages,
  }
  if (tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }))
  }

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LLM error ${res.status}: ${err}`)
  }

  return parseOAIStream(res.body, onEvent)
}

function convertMessagesToOAI(messages) {
  const result = []
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) {
      result.push({ role: msg.role, content: msg.content })
      continue
    }

    // assistant 消息：可能含 tool_use
    if (msg.role === 'assistant') {
      const textParts = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
      const toolCalls = msg.content.filter(b => b.type === 'tool_use').map(b => ({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      }))
      const oaiMsg = { role: 'assistant', content: textParts || null }
      if (toolCalls.length > 0) oaiMsg.tool_calls = toolCalls
      result.push(oaiMsg)
      continue
    }

    // user 消息：可能含 tool_result（Anthropic 格式）
    if (msg.role === 'user') {
      const toolResults = msg.content.filter(b => b.type === 'tool_result')
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          result.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.content })
        }
        continue
      }
    }

    // 普通文本
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
    result.push({ role: msg.role, content: text })
  }
  return result
}

async function parseOAIStream(stream, onEvent) {
  const content = []
  let textBuffer = ''
  const toolCallBuffers = {} // index -> { id, name, argsRaw }
  let finished = false

  for await (const line of iterLines(stream)) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '[DONE]') { finished = true; break }
    if (!data) continue

    let event
    try { event = JSON.parse(data) } catch { continue }

    const delta = event.choices?.[0]?.delta
    if (delta) {
      if (delta.content) {
        textBuffer += delta.content
        onEvent('text', { content: delta.content })
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index
          if (!toolCallBuffers[idx]) {
            toolCallBuffers[idx] = { id: '', name: '', argsRaw: '' }
          }
          if (tc.id) toolCallBuffers[idx].id = tc.id
          if (tc.function?.name) toolCallBuffers[idx].name += tc.function.name
          if (tc.function?.arguments) toolCallBuffers[idx].argsRaw += tc.function.arguments
        }
      }
    }

    const finishReason = event.choices?.[0]?.finish_reason
    if (finishReason === 'stop' || finishReason === 'tool_calls') {
      finished = true
      if (textBuffer) {
        content.push({ type: 'text', text: textBuffer })
        textBuffer = ''
      }
      for (const buf of Object.values(toolCallBuffers)) {
        let input = {}
        try { input = JSON.parse(buf.argsRaw) } catch {}
        content.push({ type: 'tool_use', id: buf.id, name: buf.name, input })
      }
    }
  }

  // 防止 finish_reason 事件丢失的情况
  if (!finished || (content.length === 0 && (textBuffer || Object.keys(toolCallBuffers).length > 0))) {
    if (textBuffer) content.push({ type: 'text', text: textBuffer })
    for (const buf of Object.values(toolCallBuffers)) {
      if (buf.name) {
        let input = {}
        try { input = JSON.parse(buf.argsRaw) } catch {}
        content.push({ type: 'tool_use', id: buf.id, name: buf.name, input })
      }
    }
  }

  return { content }
}

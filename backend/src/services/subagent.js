import fetch from 'node-fetch'

/**
 * 探测 SubAgent 的 /willknow/info 接口
 * 返回其能力描述，用于构造 LLM tool
 */
export async function probeSubAgent(url, auth) {
  const headers = {}
  if (auth?.type === 'bearer' && auth?.token) {
    headers['Authorization'] = `Bearer ${auth.token}`
  }

  const res = await fetch(`${url}/willknow/info`, { headers, signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json()
}

/**
 * 将 SubAgent 配置 + info 转换为 LLM tool 定义
 */
export function buildSubAgentTool(subAgent, info) {
  const capList = (info.capabilities || [])
    .map(c => `- ${c.name}: ${c.description}`)
    .join('\n')

  const description = `${info.name || subAgent.name}: ${info.description || ''}${capList ? '\n\nCapabilities:\n' + capList : ''}`

  return {
    subAgentId: subAgent.id,
    subAgentUrl: subAgent.url,
    subAgentAuth: subAgent.auth,
    tool: {
      name: `subagent_${subAgent.id.replace(/-/g, '_')}`,
      description,
      input_schema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: '用自然语言描述你要执行的操作',
          },
        },
        required: ['message'],
      },
    },
  }
}

/**
 * 调用 SubAgent 的 /willknow/chat 接口
 */
export async function callSubAgent(url, auth, message, sessionId) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth?.type === 'bearer' && auth?.token) {
    headers['Authorization'] = `Bearer ${auth.token}`
  }

  const body = { message }
  if (sessionId) body.session_id = sessionId

  const res = await fetch(`${url}/willknow/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SubAgent error ${res.status}: ${text}`)
  }
  return await res.json()
}

/**
 * 加载所有启用的 SubAgent，探测其能力，返回 tool 列表
 * 无法连通的 SubAgent 会被跳过（打印警告）
 */
export async function loadSubAgentTools(subAgents) {
  const tools = []
  const sessions = {} // subAgentId -> sessionId (跨轮次复用 session)

  for (const sa of subAgents) {
    if (!sa.enabled) continue
    try {
      const info = await probeSubAgent(sa.url, sa.auth)
      const entry = buildSubAgentTool(sa, info)
      tools.push(entry)
    } catch (err) {
      console.warn(`[SubAgent] 无法连通 ${sa.name} (${sa.url}): ${err.message}`)
    }
  }

  return { tools, sessions }
}

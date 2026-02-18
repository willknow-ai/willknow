import { Router } from 'express'
import { readConfig, getDefaultModel } from '../config/index.js'
import { loadSubAgentTools } from '../services/subagent.js'
import { runChat } from '../services/llm.js'

const router = Router()

// 每个对话的 SubAgent session 状态（内存中，对话级别复用）
const conversationSessions = {} // conversationId -> { subAgentId: sessionId }

router.post('/chat', async (req, res) => {
  const { message, conversationId, history = [] } = req.body
  if (!message) return res.status(400).json({ error: 'message is required' })

  const config = readConfig()
  const model = getDefaultModel()
  if (!model) {
    res.status(400).json({ error: '请先在设置页面配置并设置默认模型' })
    return
  }

  // SSE 头
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`)
  }

  try {
    // 加载 SubAgent tools
    const { tools: subAgentTools, sessions } = await loadSubAgentTools(config.subAgents || [])

    // 复用对话级别的 SubAgent sessions
    const cid = conversationId || 'default'
    if (!conversationSessions[cid]) conversationSessions[cid] = {}
    const subAgentSessions = conversationSessions[cid]

    // 构建消息历史（来自前端传入的历史记录）
    const messages = history.map(h => ({
      role: h.role,
      content: h.content,
    }))
    messages.push({ role: 'user', content: message })

    await runChat(model, messages, subAgentTools, subAgentSessions, (type, data) => {
      send(type, data)
    })

    send('done', {})
  } catch (err) {
    console.error('[chat error]', err)
    send('error', { message: err.message })
  } finally {
    res.end()
  }
})

export default router

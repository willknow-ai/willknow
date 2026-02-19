import { Router } from 'express'
import { readConfig, writeConfig } from '../config/index.js'
import { probeSubAgent } from '../services/subagent.js'
import { channelManager } from '../services/channels/manager.js'
import fetch from 'node-fetch'

const router = Router()

router.get('/settings', (req, res) => {
  res.json(readConfig())
})

router.put('/settings', async (req, res) => {
  const config = req.body
  if (!config || typeof config !== 'object') {
    return res.status(400).json({ error: 'Invalid config' })
  }
  writeConfig(config)

  // 配置变更后同步通道（非阻塞）
  channelManager.sync(config).catch(err =>
    console.error('[ChannelManager] sync error:', err.message)
  )

  res.json({ ok: true })
})

// 探测 SubAgent 连通性
router.post('/subagents/probe', async (req, res) => {
  const { url, auth } = req.body
  if (!url) return res.status(400).json({ error: 'url is required' })
  try {
    const info = await probeSubAgent(url, auth)
    res.json({ ok: true, info })
  } catch (err) {
    res.json({ ok: false, error: err.message })
  }
})

// 探测模型连通性（发送最小请求验证 API Key 和 Base URL）
router.post('/models/probe', async (req, res) => {
  const { provider, apiKey, baseURL, model } = req.body
  if (!apiKey) return res.json({ ok: false, error: '请填写 API Key' })

  try {
    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model || 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(12000),
      })
      const data = await r.json()
      if (!r.ok) {
        return res.json({ ok: false, error: data.error?.message || `HTTP ${r.status}` })
      }
      return res.json({ ok: true })
    } else {
      // OpenAI-compatible
      const base = (baseURL || 'https://api.openai.com/v1').replace(/\/$/, '')
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(12000),
      })
      const data = await r.json()
      if (!r.ok) {
        return res.json({ ok: false, error: data.error?.message || `HTTP ${r.status}` })
      }
      return res.json({ ok: true })
    }
  } catch (err) {
    const msg = err.message?.includes('fetch') || err.code === 'ECONNREFUSED' || err.name === 'TimeoutError'
      ? `无法连接到服务器（${err.message}）`
      : err.message
    res.json({ ok: false, error: msg })
  }
})

export default router



import { Router } from 'express'
import { readConfig, writeConfig } from '../config/index.js'
import { probeSubAgent } from '../services/subagent.js'
import { channelManager } from '../services/channels/manager.js'

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

export default router


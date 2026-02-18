import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import chatRouter from './routes/chat.js'
import settingsRouter from './routes/settings.js'
import { readConfig } from './config/index.js'
import { channelManager } from './services/channels/manager.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

app.use('/api', chatRouter)
app.use('/api', settingsRouter)

// 通道状态查询
app.get('/api/channels/status', (req, res) => {
  res.json(channelManager.getStatus())
})

app.listen(PORT, async () => {
  console.log(`willknow-client backend running on http://localhost:${PORT}`)
  // 启动时自动连接已启用的通道
  const config = readConfig()
  if (config.channels?.some(c => c.enabled)) {
    console.log('[ChannelManager] 初始化通道...')
    await channelManager.sync(config)
  }
})


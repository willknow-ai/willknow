import { QQChannel } from './qq.js'
import { loadSubAgentTools } from '../subagent.js'
import { runChat } from '../llm.js'

/**
 * Channel Manager：管理所有通道实例的生命周期
 * 每次配置变更时调用 sync() 重新启动通道
 */
class ChannelManager {
  constructor() {
    // channelId -> QQChannel 实例
    this.channels = new Map()
    // chatId -> { history: [], subAgentSessions: {} }
    this.sessions = new Map()
  }

  /**
   * 根据最新配置同步通道（停止旧的，启动新的）
   */
  async sync(config) {
    const newChannels = (config.channels || []).filter(c => c.enabled)
    const newIds = new Set(newChannels.map(c => c.id))

    // 停止已删除或禁用的通道
    for (const [id, ch] of this.channels.entries()) {
      if (!newIds.has(id)) {
        console.log(`[ChannelManager] 停止通道 ${id}`)
        ch.stop()
        this.channels.delete(id)
      }
    }

    // 启动新增或凭据变更的通道
    for (const chConfig of newChannels) {
      const existing = this.channels.get(chConfig.id)
      if (existing) {
        // 检查凭据是否变更，变更则重启
        const cfg = chConfig.config || {}
        if (existing._appId === cfg.appId && existing._clientSecret === cfg.appSecret) continue
        console.log(`[ChannelManager] 凭据变更，重启通道 ${chConfig.id}`)
        existing.stop()
        this.channels.delete(chConfig.id)
      }
      console.log(`[ChannelManager] 启动通道 ${chConfig.id} (${chConfig.type})`)
      await this._startChannel(chConfig, config)
    }
  }

  /**
   * 停止所有通道
   */
  stopAll() {
    for (const ch of this.channels.values()) ch.stop()
    this.channels.clear()
  }

  /**
   * 获取所有通道状态
   */
  getStatus() {
    const result = {}
    for (const [id, ch] of this.channels.entries()) {
      result[id] = { status: ch.status, error: ch.error || null }
    }
    return result
  }

  // ── 私有方法 ──────────────────────────────────────────────

  async _startChannel(chConfig, appConfig) {
    if (chConfig.type !== 'qq') {
      console.warn(`[ChannelManager] 不支持的通道类型: ${chConfig.type}`)
      return
    }

    const channel = new QQChannel(
      {
        appId: chConfig.config?.appId,
        clientSecret: chConfig.config?.appSecret,
      },
      (chatId, text) => this._handleMessage(chatId, text, appConfig)
    )
    // 记录凭据，供 sync() 对比是否变更
    channel._appId = chConfig.config?.appId
    channel._clientSecret = chConfig.config?.appSecret
    this.channels.set(chConfig.id, channel)

    // 非阻塞启动（start 内部有 try/catch）
    channel.start().catch(err => console.error(`[QQ:${chConfig.id}]`, err.message))
  }

  async _handleMessage(chatId, text, appConfig) {
    // 取或建会话
    if (!this.sessions.has(chatId)) {
      this.sessions.set(chatId, { history: [], subAgentSessions: {} })
    }
    const session = this.sessions.get(chatId)

    const model = appConfig.models?.find(m => m.isDefault) || appConfig.models?.[0]
    if (!model) return '请先在管理页面配置并设置默认模型。'

    // 加载 SubAgent tools
    const { tools: subAgentTools } = await loadSubAgentTools(appConfig.subAgents || [])

    // 追加用户消息
    session.history.push({ role: 'user', content: text })

    // 收集 LLM 回复
    let fullText = ''
    try {
      await runChat(model, session.history, subAgentTools, session.subAgentSessions, (type, data) => {
        if (type === 'text') fullText += data.content
      })
    } catch (err) {
      console.error('[ChannelManager] LLM error:', err.message)
      session.history.pop()  // 回滚用户消息，避免脏历史
      return `处理失败: ${err.message}`
    }

    // 追加助手回复到历史
    if (fullText) {
      session.history.push({ role: 'assistant', content: fullText })
    }

    // 限制历史长度，避免 token 过多（保留最近 40 条）
    if (session.history.length > 40) {
      session.history = session.history.slice(-40)
    }

    return fullText || '（无响应）'
  }
}

// 单例导出
export const channelManager = new ChannelManager()

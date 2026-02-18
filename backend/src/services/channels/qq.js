import WebSocket from 'ws'
import fetch from 'node-fetch'

const QQ_API = 'https://api.sgroup.qq.com'
const QQ_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'

// GROUP_AT_MESSAGE_CREATE + C2C_MESSAGE_CREATE
const INTENT_GROUP_AND_C2C = 1 << 25

/**
 * QQ 机器人通道
 * 通过 WebSocket 接收消息，通过 HTTP 回复消息
 */
export class QQChannel {
  constructor(config, onMessage) {
    this.appId = config.appId
    this.clientSecret = config.clientSecret
    // onMessage: async (chatId, text) => string
    this.onMessage = onMessage

    this.accessToken = null
    this.ws = null
    this.sessionId = null
    this.lastSeq = null
    this.heartbeatTimer = null
    this.tokenRefreshTimer = null
    this.botId = null

    this.status = 'disconnected'  // disconnected | connecting | connected | error
    this.error = null
    this._stopped = false
  }

  async start() {
    this._stopped = false
    this.status = 'connecting'
    this.error = null
    try {
      await this._refreshToken()
      await this._connect()
    } catch (err) {
      this.status = 'error'
      this.error = err.message
      console.error('[QQ] Start failed:', err.message)
    }
  }

  stop() {
    this._stopped = true
    clearInterval(this.heartbeatTimer)
    clearTimeout(this.tokenRefreshTimer)
    this.heartbeatTimer = null
    this.tokenRefreshTimer = null
    if (this.ws) {
      this.ws.terminate()
      this.ws = null
    }
    this.status = 'disconnected'
  }

  // ── Token 管理 ─────────────────────────────────────────

  async _refreshToken() {
    const res = await fetch(QQ_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.clientSecret }),
    })
    const data = await res.json()
    if (!data.access_token) throw new Error(`获取 Token 失败: ${JSON.stringify(data)}`)

    this.accessToken = data.access_token
    const expiresIn = parseInt(data.expires_in) || 7200
    // 提前 2 分钟刷新
    this.tokenRefreshTimer = setTimeout(
      () => !this._stopped && this._refreshToken(),
      (expiresIn - 120) * 1000
    )
    console.log('[QQ] Access token 已刷新')
  }

  // ── WebSocket 连接 ──────────────────────────────────────

  async _connect() {
    if (this._stopped) return

    // 获取网关地址
    const gatewayRes = await fetch(`${QQ_API}/gateway/bot`, {
      headers: { 'Authorization': `QQBot ${this.accessToken}` },
    })
    const gateway = await gatewayRes.json()
    if (!gateway.url) throw new Error(`获取网关失败: ${JSON.stringify(gateway)}`)

    console.log('[QQ] 连接 WebSocket:', gateway.url)
    this.ws = new WebSocket(gateway.url)

    this.ws.on('open', () => console.log('[QQ] WebSocket 已连接，正在鉴权...'))

    this.ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString())
        this._handleWsMessage(msg)
      } catch (e) {
        console.error('[QQ] 消息解析失败:', e.message)
      }
    })

    this.ws.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || ''
      console.log(`[QQ] WebSocket 断开，code=${code}${reasonStr ? ' reason=' + reasonStr : ''}`)
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null

      if (this._stopped) return

      // 永久性错误不重试
      const PERMANENT_ERRORS = [4013, 4014] // Invalid Intent / Disallowed Intent
      if (PERMANENT_ERRORS.includes(code)) {
        this.status = 'error'
        this.error = `连接被拒绝 (code=${code})：${reasonStr || '请检查机器人权限配置'}`
        console.error('[QQ] 永久性错误，停止重连:', this.error)
        return
      }

      this.status = 'connecting'
      setTimeout(() => !this._stopped && this._connect(), 5000)
    })

    this.ws.on('error', err => {
      console.error('[QQ] WebSocket 错误:', err.message)
      this.status = 'error'
      this.error = err.message
    })
  }

  // ── WebSocket 消息处理 ──────────────────────────────────

  _handleWsMessage(msg) {
    const { op, t, s, d } = msg

    // 更新序列号（用于心跳和断线重连）
    if (s != null) this.lastSeq = s

    if (op === 10) {
      // Hello：启动心跳 + 鉴权
      const interval = d.heartbeat_interval
      this.heartbeatTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ op: 1, d: this.lastSeq }))
        }
      }, interval)

      this.ws.send(JSON.stringify({
        op: 2,
        d: {
          token: `QQBot ${this.accessToken}`,
          intents: INTENT_GROUP_AND_C2C,
          shard: [0, 1],
        },
      }))
    } else if (op === 11) {
      // Heartbeat ACK - 正常，不需要打印
    } else if (op === 9) {
      // Invalid session：关闭当前连接，由 close 事件处理重连（避免竞争）
      const resumable = d === true
      console.warn(`[QQ] Invalid Session (resumable=${resumable})，关闭当前连接...`)
      this.ws?.close()
    } else if (op === 0) {
      // Dispatch
      if (t === 'READY') {
        this.sessionId = d.session_id
        this.botId = d.user?.id
        this.status = 'connected'
        this.error = null
        console.log(`[QQ] Bot 就绪，botId=${this.botId}，session=${this.sessionId}`)
      } else if (t === 'GROUP_AT_MESSAGE_CREATE') {
        this._handleGroupMessage(d)
      } else if (t === 'C2C_MESSAGE_CREATE') {
        this._handleC2CMessage(d)
      }
    } else {
      console.log(`[QQ] 收到未处理的 op=${op} t=${t}`)
    }
  }

  // ── 消息处理 ────────────────────────────────────────────

  async _handleGroupMessage(d) {
    // 去掉 @bot 标记，提取纯文本
    const text = (d.content || '').replace(/<@!\d+>/g, '').trim()
    if (!text) return

    const chatId = `group:${d.group_openid}`
    console.log(`[QQ] 群消息 [${d.group_openid}]: ${text}`)

    try {
      const reply = await this.onMessage(chatId, text)
      await this._sendGroupMessage(d.group_openid, d.id, reply)
    } catch (err) {
      console.error('[QQ] 处理群消息失败:', err.message)
    }
  }

  async _handleC2CMessage(d) {
    const text = (d.content || '').trim()
    if (!text) return

    // C2C 事件中用户 ID 在 d.author.id 或 d.from_openid
    const userOpenid = d.author?.id || d.from_openid
    if (!userOpenid) {
      console.error('[QQ] C2C 消息缺少 user_openid，原始数据:', JSON.stringify(d))
      return
    }

    const chatId = `c2c:${userOpenid}`
    console.log(`[QQ] 私聊消息 [${userOpenid}]: ${text}`)

    try {
      const reply = await this.onMessage(chatId, text)
      await this._sendC2CMessage(userOpenid, d.id, reply)
    } catch (err) {
      console.error('[QQ] 处理私聊消息失败:', err.message)
    }
  }

  // ── 消息发送 ────────────────────────────────────────────

  async _sendGroupMessage(groupOpenid, msgId, content) {
    // QQ 单条消息最多 2000 字符
    const text = content.slice(0, 2000)
    const res = await fetch(`${QQ_API}/v2/groups/${groupOpenid}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `QQBot ${this.accessToken}`,
      },
      body: JSON.stringify({ content: text, msg_type: 0, msg_id: msgId }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('[QQ] 发送群消息失败:', err)
    }
  }

  async _sendC2CMessage(userOpenid, msgId, content) {
    const text = content.slice(0, 2000)
    const res = await fetch(`${QQ_API}/v2/users/${userOpenid}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `QQBot ${this.accessToken}`,
      },
      body: JSON.stringify({ content: text, msg_type: 0, msg_id: msgId }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('[QQ] 发送私聊消息失败:', err)
    }
  }
}

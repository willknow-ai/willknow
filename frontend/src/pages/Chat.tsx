import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Layout, Input, Button, Typography, Space, Tooltip, Empty,
  Collapse, Tag, Spin
} from 'antd'
import {
  SendOutlined, SettingOutlined, PlusOutlined,
  RobotOutlined, UserOutlined, ApiOutlined, DeleteOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { v4 as uuidv4 } from 'uuid'
import type { ChatMessage, Conversation, ToolCallInfo } from '../types/config'

const { Sider, Content, Header } = Layout
const { Text } = Typography
const { TextArea } = Input

const STORAGE_KEY = 'willknow_conversations'

function loadConversations(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function saveConversations(convs: Conversation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(convs))
}

function newConversation(): Conversation {
  return { id: uuidv4(), title: '新对话', messages: [], createdAt: Date.now() }
}

// 工具调用折叠展示组件
function ToolCallCard({ info }: { info: ToolCallInfo }) {
  return (
    <Collapse
      size="small"
      ghost
      style={{ marginBottom: 4, background: '#fafafa', borderRadius: 6, border: '1px solid #f0f0f0' }}
      items={[{
        key: '1',
        label: (
          <Space size={4}>
            <ApiOutlined style={{ color: '#722ed1' }} />
            <Text style={{ fontSize: 12 }} type="secondary">
              调用 <Text strong style={{ fontSize: 12 }}>{info.agentName}</Text>
            </Text>
            {info.result !== undefined && <Tag color="green" style={{ fontSize: 11, marginLeft: 4 }}>已完成</Tag>}
          </Space>
        ),
        children: (
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            <div style={{ marginBottom: 4 }}>
              <Text type="secondary">指令：</Text>
              <Text>{info.input}</Text>
            </div>
            {info.result !== undefined && (
              <div>
                <Text type="secondary">结果：</Text>
                <Text>{info.result}</Text>
              </div>
            )}
          </div>
        )
      }]}
    />
  )
}

// 消息气泡
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{
      display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row',
      gap: 10, marginBottom: 16, alignItems: 'flex-start'
    }}>
      {/* 头像 */}
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: isUser ? '#1677ff' : '#722ed1',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14
      }}>
        {isUser ? <UserOutlined /> : <RobotOutlined />}
      </div>

      {/* 内容 */}
      <div style={{ maxWidth: '72%' }}>
        {/* 工具调用信息 */}
        {msg.toolCalls && msg.toolCalls.map((tc, i) => <ToolCallCard key={i} info={tc} />)}

        {/* 文字内容 */}
        {msg.content && (
          <div style={{
            padding: '10px 14px',
            background: isUser ? '#1677ff' : '#fff',
            color: isUser ? '#fff' : '#000',
            borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            fontSize: 14, lineHeight: 1.7,
          }}>
            {isUser ? (
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
            ) : (
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Chat() {
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations)
  const [currentId, setCurrentId] = useState<string | null>(() => loadConversations()[0]?.id || null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const current = conversations.find(c => c.id === currentId) || null

  useEffect(() => {
    saveConversations(conversations)
  }, [conversations])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [current?.messages])

  const updateConversation = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setConversations(prev => prev.map(c => c.id === id ? updater(c) : c))
  }, [])

  const startNew = () => {
    const conv = newConversation()
    setConversations(prev => [conv, ...prev])
    setCurrentId(conv.id)
  }

  const deleteConv = (id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id))
    if (currentId === id) setCurrentId(null)
  }

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return

    let convId = currentId
    if (!convId) {
      const conv = newConversation()
      setConversations(prev => [conv, ...prev])
      setCurrentId(conv.id)
      convId = conv.id
    }

    const userMsg: ChatMessage = { id: uuidv4(), role: 'user', content: text }
    const assistantMsg: ChatMessage = { id: uuidv4(), role: 'assistant', content: '', toolCalls: [] }

    // 更新对话标题（取第一条消息前 20 字）
    updateConversation(convId, c => ({
      ...c,
      title: c.messages.length === 0 ? text.slice(0, 20) : c.title,
      messages: [...c.messages, userMsg, assistantMsg],
    }))

    setInput('')
    setStreaming(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    // 构建传给后端的历史（不含刚加入的 assistant 占位）
    const history = (conversations.find(c => c.id === convId)?.messages || []).map(m => ({
      role: m.role,
      content: m.content,
    }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationId: convId, history }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        const lines = buf.split('\n')
        buf = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          let event: { type: string; content?: string; tool?: string; agentName?: string; input?: string; message?: string }
          try { event = JSON.parse(data) } catch { continue }

          if (event.type === 'text') {
            updateConversation(convId!, c => ({
              ...c,
              messages: c.messages.map(m =>
                m.id === assistantMsg.id ? { ...m, content: m.content + (event.content || '') } : m
              ),
            }))
          } else if (event.type === 'tool_call') {
            const toolCall: ToolCallInfo = {
              tool: event.tool || '',
              agentName: event.agentName || '',
              input: event.input || '',
            }
            updateConversation(convId!, c => ({
              ...c,
              messages: c.messages.map(m =>
                m.id === assistantMsg.id ? { ...m, toolCalls: [...(m.toolCalls || []), toolCall] } : m
              ),
            }))
          } else if (event.type === 'tool_result') {
            // 更新最后一个 tool call 的 result
            updateConversation(convId!, c => ({
              ...c,
              messages: c.messages.map(m => {
                if (m.id !== assistantMsg.id || !m.toolCalls?.length) return m
                const toolCalls = [...m.toolCalls]
                const last = toolCalls.length - 1
                toolCalls[last] = { ...toolCalls[last], result: event.content || '' }
                return { ...m, toolCalls }
              }),
            }))
          } else if (event.type === 'error') {
            updateConversation(convId!, c => ({
              ...c,
              messages: c.messages.map(m =>
                m.id === assistantMsg.id ? { ...m, content: `错误: ${event.message}` } : m
              ),
            }))
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        updateConversation(convId!, c => ({
          ...c,
          messages: c.messages.map(m =>
            m.id === assistantMsg.id ? { ...m, content: `发送失败: ${(err as Error).message}` } : m
          ),
        }))
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <Layout style={{ height: '100vh' }}>
      {/* 左侧对话列表 */}
      <Sider width={240} style={{ background: '#fff', borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <Button icon={<PlusOutlined />} block onClick={startNew}>新对话</Button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {conversations.length === 0 ? (
            <div style={{ padding: '24px 16px', color: '#bfbfbf', fontSize: 13, textAlign: 'center' }}>暂无对话</div>
          ) : (
            conversations.map(c => (
              <div
                key={c.id}
                onClick={() => setCurrentId(c.id)}
                style={{
                  padding: '8px 16px', cursor: 'pointer', borderRadius: 6,
                  margin: '2px 8px',
                  background: c.id === currentId ? '#f0f5ff' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
              >
                <Text
                  ellipsis
                  style={{ fontSize: 13, color: c.id === currentId ? '#1677ff' : '#262626', flex: 1 }}
                >
                  {c.title}
                </Text>
                <Tooltip title="删除">
                  <Button
                    type="text" size="small" danger
                    icon={<DeleteOutlined />}
                    onClick={e => { e.stopPropagation(); deleteConv(c.id) }}
                    style={{ opacity: 0.5 }}
                  />
                </Tooltip>
              </div>
            ))
          )}
        </div>
      </Sider>

      {/* 右侧主区域 */}
      <Layout>
        <Header style={{
          background: '#fff', padding: '0 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid #f0f0f0', height: 52
        }}>
          <Space>
            <RobotOutlined style={{ color: '#722ed1', fontSize: 18 }} />
            <Text strong style={{ fontSize: 15 }}>Willknow</Text>
          </Space>
          <Tooltip title="设置">
            <Button type="text" icon={<SettingOutlined />} onClick={() => navigate('/settings')} />
          </Tooltip>
        </Header>

        <Content style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f7f8fa' }}>
          {/* 消息区 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 10%' }}>
            {!current || current.messages.length === 0 ? (
              <Empty
                image={<RobotOutlined style={{ fontSize: 64, color: '#d9d9d9' }} />}
                description={<Text type="secondary">开始一段新的对话</Text>}
                style={{ marginTop: 80 }}
              />
            ) : (
              current.messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)
            )}
            {streaming && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#722ed1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Spin size="small" style={{ filter: 'brightness(10)' }} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* 输入区 */}
          <div style={{ padding: '12px 10%', background: '#fff', borderTop: '1px solid #f0f0f0' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <TextArea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                autoSize={{ minRows: 1, maxRows: 5 }}
                style={{ flex: 1, resize: 'none' }}
                disabled={streaming}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={send}
                loading={streaming}
                disabled={!input.trim()}
                style={{ height: 'auto', padding: '6px 16px' }}
              >
                发送
              </Button>
            </div>
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}

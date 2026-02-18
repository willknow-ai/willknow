export interface ModelConfig {
  id: string
  name: string
  provider: 'anthropic' | 'openai_compatible'
  apiKey: string
  baseURL?: string
  model: string
  isDefault?: boolean
}

export interface ChannelConfig {
  id: string
  type: 'qq' | 'wechat' | 'slack' | 'telegram'
  name: string
  config: Record<string, string>
  enabled: boolean
}

export interface SkillConfig {
  id: string
  name: string
  version: string
  enabled: boolean
}

export interface SubAgentAuth {
  type: 'none' | 'bearer'
  token?: string
}

export interface SubAgentConfig {
  id: string
  name: string
  url: string
  auth: SubAgentAuth
  enabled: boolean
}

export interface AppConfig {
  models: ModelConfig[]
  channels: ChannelConfig[]
  skills: SkillConfig[]
  subAgents: SubAgentConfig[]
}

// Chat types
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallInfo[]
}

export interface ToolCallInfo {
  tool: string
  agentName: string
  input: string
  result?: string
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
}

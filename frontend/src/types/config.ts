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
  id: string           // "resend/resend-skills/send-email"
  name: string         // skill name from SKILL.md frontmatter
  description: string  // from SKILL.md frontmatter
  version?: string     // from metadata.version
  source: string       // "owner/repo"
  skillsShUrl: string  // "https://skills.sh/resend/resend-skills/send-email"
  content: string      // full SKILL.md content (loaded on activation via read_skill)
  hasScripts: boolean  // whether skill has scripts/ directory
  enabled: boolean
  installedAt: number
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

import { useState } from 'react'
import {
  Button, List, Tag, Popconfirm, Input, Typography,
  Space, Tabs, Spin, Switch, Tooltip, message,
} from 'antd'
import {
  SearchOutlined, DeleteOutlined, LinkOutlined,
  WarningOutlined, CheckCircleOutlined,
} from '@ant-design/icons'
import type { SkillConfig } from '../../types/config'

const { Text } = Typography

interface SearchResult {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
}

interface Props {
  skills: SkillConfig[]
  onChange: (skills: SkillConfig[]) => void
}

export default function SkillsPanel({ skills, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [installing, setInstalling] = useState<string | null>(null)

  const doSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setResults([])
    try {
      const res = await fetch(`/api/skills/search?q=${encodeURIComponent(query.trim())}`)
      const data = await res.json()
      // skills.sh API returns { skills: [...], count, query, duration_ms }
      if (Array.isArray(data.skills)) setResults(data.skills)
      else if (Array.isArray(data)) setResults(data)
      else throw new Error(data.error || '搜索失败')
    } catch (e) {
      message.error(`搜索失败: ${(e as Error).message}`)
    } finally {
      setSearching(false)
    }
  }

  const doInstall = async (result: SearchResult) => {
    if (skills.find(s => s.id === result.id)) {
      message.warning('该技能已安装')
      return
    }
    setInstalling(result.id)
    try {
      const res = await fetch('/api/skills/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: result.id }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)

      const skill: SkillConfig = data.skill
      onChange([...skills, skill])

      if (skill.hasScripts) {
        message.warning({
          content: `「${skill.name}」已安装。此技能包含 scripts/ 目录，willknow 暂不支持执行技能脚本，相关功能可能受限。`,
          duration: 6,
        })
      } else {
        message.success(`「${skill.name}」已安装`)
      }
    } catch (e) {
      message.error(`安装失败: ${(e as Error).message}`)
    } finally {
      setInstalling(null)
    }
  }

  const doDelete = (id: string) => {
    onChange(skills.filter(s => s.id !== id))
  }

  const doToggle = (id: string, enabled: boolean) => {
    onChange(skills.map(s => s.id === id ? { ...s, enabled } : s))
  }

  const installedTab = (
    <List
      dataSource={skills}
      size="small"
      locale={{ emptyText: '暂未安装任何技能，前往「搜索安装」' }}
      renderItem={skill => (
        <List.Item
          actions={[
            <Switch
              key="toggle"
              size="small"
              checked={skill.enabled}
              onChange={enabled => doToggle(skill.id, enabled)}
            />,
            <Tooltip title="在 skills.sh 查看" key="link">
              <Button
                type="text" size="small"
                icon={<LinkOutlined />}
                onClick={() => window.open(skill.skillsShUrl, '_blank')}
              />
            </Tooltip>,
            <Popconfirm title="确认卸载？" onConfirm={() => doDelete(skill.id)} key="del">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>,
          ]}
        >
          <List.Item.Meta
            title={
              <Space size={4}>
                <Text style={{ fontSize: 13 }}>{skill.name}</Text>
                {skill.version && <Tag style={{ fontSize: 11 }}>v{skill.version}</Tag>}
                {skill.hasScripts && (
                  <Tooltip title="此技能包含 scripts/ 目录，willknow 暂不支持执行技能脚本">
                    <WarningOutlined style={{ color: '#fa8c16', fontSize: 12 }} />
                  </Tooltip>
                )}
                {!skill.enabled && <Tag color="default" style={{ fontSize: 11 }}>已禁用</Tag>}
              </Space>
            }
            description={<Text type="secondary" style={{ fontSize: 11 }}>{skill.source}</Text>}
          />
        </List.Item>
      )}
    />
  )

  const searchTab = (
    <div>
      <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
        <Input
          placeholder="搜索技能，如 send-email..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onPressEnter={doSearch}
        />
        <Button icon={<SearchOutlined />} onClick={doSearch} loading={searching}>
          搜索
        </Button>
      </Space.Compact>

      {searching ? (
        <div style={{ textAlign: 'center', padding: '16px 0' }}><Spin size="small" /></div>
      ) : (
        <List
          dataSource={results}
          size="small"
          locale={{ emptyText: query && !searching ? '无结果' : '输入关键词搜索 skills.sh' }}
          renderItem={r => {
            const installed = skills.some(s => s.id === r.id)
            return (
              <List.Item
                actions={[
                  installed ? (
                    <CheckCircleOutlined key="ok" style={{ color: '#52c41a' }} />
                  ) : (
                    <Button
                      key="install"
                      size="small"
                      type="primary"
                      loading={installing === r.id}
                      onClick={() => doInstall(r)}
                    >
                      安装
                    </Button>
                  ),
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={6}>
                      <a
                        href={`https://skills.sh/${r.id}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 13 }}
                      >
                        {r.name}
                      </a>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {r.installs.toLocaleString()} installs
                      </Text>
                    </Space>
                  }
                  description={<Text type="secondary" style={{ fontSize: 11 }}>{r.source}</Text>}
                />
              </List.Item>
            )
          }}
        />
      )}
    </div>
  )

  return (
    <Tabs
      size="small"
      items={[
        {
          key: 'installed',
          label: `已安装${skills.length > 0 ? ` (${skills.length})` : ''}`,
          children: installedTab,
        },
        {
          key: 'search',
          label: '搜索安装',
          children: searchTab,
        },
      ]}
    />
  )
}

import { useEffect, useState } from 'react'
import { Layout, Typography, Button, Row, Col, Card, Divider, message, Spin } from 'antd'
import { ArrowLeftOutlined, RobotOutlined, WechatOutlined, ThunderboltOutlined, ApiOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import ModelsPanel from '../components/settings/ModelsPanel'
import SubAgentsPanel from '../components/settings/SubAgentsPanel'
import ChannelsPanel from '../components/settings/ChannelsPanel'
import SkillsPanel from '../components/settings/SkillsPanel'
import type { AppConfig } from '../types/config'

const { Header, Content } = Layout
const { Title } = Typography

const DEFAULT_CONFIG: AppConfig = { models: [], channels: [], skills: [], subAgents: [] }

export default function Settings() {
  const navigate = useNavigate()
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => { setConfig(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const save = async (next: AppConfig) => {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      message.success('已保存')
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const update = (key: keyof AppConfig) => (val: AppConfig[typeof key]) => {
    const next = { ...config, [key]: val }
    setConfig(next)
    save(next)
  }

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
          返回对话
        </Button>
        <Divider type="vertical" />
        <Title level={5} style={{ margin: 0 }}>设置</Title>
        {saving && <span style={{ fontSize: 12, color: '#8c8c8c' }}>保存中...</span>}
      </Header>

      <Content style={{ padding: 24 }}>
        {loading ? (
          <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>
        ) : (
          <Row gutter={[16, 16]}>
            {/* 第一行：模型 + 通道 */}
            <Col xs={24} md={12}>
              <Card
                title={<><RobotOutlined style={{ marginRight: 8, color: '#1677ff' }} />模型 (Models)</>}
                size="small"
                style={{ height: 340 }}
                styles={{ body: { height: 'calc(100% - 38px)', overflowY: 'auto' } }}
              >
                <ModelsPanel models={config.models} onChange={update('models')} />
              </Card>
            </Col>

            <Col xs={24} md={12}>
              <Card
                title={<><WechatOutlined style={{ marginRight: 8, color: '#52c41a' }} />通道 (Channels)</>}
                size="small"
                style={{ height: 340 }}
                styles={{ body: { height: 'calc(100% - 38px)', overflowY: 'auto' } }}
              >
                <ChannelsPanel channels={config.channels} onChange={update('channels')} />
              </Card>
            </Col>

            {/* 第二行：技能 + SubAgents */}
            <Col xs={24} md={12}>
              <Card
                title={<><ThunderboltOutlined style={{ marginRight: 8, color: '#fa8c16' }} />技能 (Skills)</>}
                size="small"
                style={{ height: 340 }}
                styles={{ body: { height: 'calc(100% - 38px)', overflowY: 'auto' } }}
              >
                <SkillsPanel skills={config.skills} onChange={update('skills')} />
              </Card>
            </Col>

            <Col xs={24} md={12}>
              <Card
                title={<><ApiOutlined style={{ marginRight: 8, color: '#722ed1' }} />SubAgents</>}
                size="small"
                style={{ height: 340 }}
                styles={{ body: { height: 'calc(100% - 38px)', overflowY: 'auto' } }}
              >
                <SubAgentsPanel subAgents={config.subAgents} onChange={update('subAgents')} />
              </Card>
            </Col>
          </Row>
        )}
      </Content>
    </Layout>
  )
}

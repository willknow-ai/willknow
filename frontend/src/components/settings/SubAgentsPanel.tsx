import { useState } from 'react'
import {
  Button, List, Tag, Popconfirm, Modal, Form, Input, Space,
  Badge, message, Typography, Collapse, Tooltip
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  ApiOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined
} from '@ant-design/icons'
import { v4 as uuidv4 } from 'uuid'
import type { SubAgentConfig } from '../../types/config'

const { Text } = Typography

interface ProbeResult {
  ok: boolean
  info?: {
    name: string
    description: string
    capabilities: Array<{ name: string; description: string }>
  }
  error?: string
}

interface Props {
  subAgents: SubAgentConfig[]
  onChange: (subAgents: SubAgentConfig[]) => void
}

export default function SubAgentsPanel({ subAgents, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SubAgentConfig | null>(null)
  const [form] = Form.useForm()
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null)

  const openAdd = () => {
    setEditing(null)
    setProbeResult(null)
    form.resetFields()
    form.setFieldsValue({ auth: { type: 'none' }, enabled: true })
    setOpen(true)
  }

  const openEdit = (sa: SubAgentConfig) => {
    setEditing(sa)
    setProbeResult(null)
    form.setFieldsValue(sa)
    setOpen(true)
  }

  const onProbe = async () => {
    const url = form.getFieldValue('url')
    const auth = form.getFieldValue('auth')
    if (!url) { message.warning('请先填写 URL'); return }
    setProbing(true)
    setProbeResult(null)
    try {
      const res = await fetch('/api/subagents/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, auth }),
      })
      const data = await res.json()
      setProbeResult(data)
      if (data.ok && data.info?.name && !form.getFieldValue('name')) {
        form.setFieldsValue({ name: data.info.name })
      }
    } catch (e) {
      setProbeResult({ ok: false, error: String(e) })
    } finally {
      setProbing(false)
    }
  }

  const onSave = () => {
    form.validateFields().then(values => {
      if (editing) {
        onChange(subAgents.map(sa => sa.id === editing.id ? { ...sa, ...values } : sa))
      } else {
        onChange([...subAgents, { id: uuidv4(), ...values }])
      }
      setOpen(false)
    })
  }

  const onDelete = (id: string) => {
    onChange(subAgents.filter(sa => sa.id !== id))
  }

  const onToggle = (id: string, enabled: boolean) => {
    onChange(subAgents.map(sa => sa.id === id ? { ...sa, enabled } : sa))
  }

  return (
    <div>
      <List
        dataSource={subAgents}
        locale={{ emptyText: '暂无 SubAgent，点击下方添加' }}
        renderItem={sa => (
          <List.Item
            actions={[
              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(sa)} key="edit" />,
              <Popconfirm title="确认删除？" onConfirm={() => onDelete(sa.id)} key="del">
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              avatar={
                <Badge
                  status={sa.enabled ? 'success' : 'default'}
                  onClick={() => onToggle(sa.id, !sa.enabled)}
                  style={{ cursor: 'pointer' }}
                />
              }
              title={
                <Space>
                  {sa.name}
                  <Tag color={sa.enabled ? 'green' : 'default'}>
                    {sa.enabled ? '已启用' : '已禁用'}
                  </Tag>
                </Space>
              }
              description={<Text type="secondary" style={{ fontSize: 12 }}>{sa.url}</Text>}
            />
          </List.Item>
        )}
      />
      <Button icon={<PlusOutlined />} onClick={openAdd} block style={{ marginTop: 8 }}>
        添加 SubAgent
      </Button>

      <Modal
        title={editing ? '编辑 SubAgent' : '添加 SubAgent'}
        open={open}
        onOk={onSave}
        onCancel={() => setOpen(false)}
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="SubAgent URL" style={{ marginBottom: 4 }}>
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="url" noStyle rules={[{ required: true }]}>
                <Input placeholder="http://localhost:8888" />
              </Form.Item>
              <Tooltip title="探测连通性">
                <Button
                  icon={probing ? <LoadingOutlined /> : <ApiOutlined />}
                  onClick={onProbe}
                  disabled={probing}
                >
                  探测
                </Button>
              </Tooltip>
            </Space.Compact>
          </Form.Item>
          <div style={{ marginBottom: 12, fontSize: 12, color: '#8c8c8c' }}>
            willknow 以 Docker 运行时，宿主机上的 SubAgent 请将{' '}
            <Text code style={{ fontSize: 11 }}>localhost</Text>
            {' '}改为{' '}
            <Text code style={{ fontSize: 11 }}>host.docker.internal</Text>
            ，如：<Text code style={{ fontSize: 11 }}>http://host.docker.internal:8888</Text>
          </div>

          {probeResult && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: probeResult.ok ? '#f6ffed' : '#fff2f0', borderRadius: 6, border: `1px solid ${probeResult.ok ? '#b7eb8f' : '#ffccc7'}` }}>
              {probeResult.ok ? (
                <>
                  <Space style={{ marginBottom: 4 }}>
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    <Text strong>{probeResult.info?.name}</Text>
                  </Space>
                  <div><Text type="secondary" style={{ fontSize: 12 }}>{probeResult.info?.description}</Text></div>
                  {(probeResult.info?.capabilities?.length ?? 0) > 0 && (
                    <Collapse size="small" ghost style={{ marginTop: 4 }} items={[{
                      key: '1',
                      label: <Text style={{ fontSize: 12 }}>查看 {probeResult.info!.capabilities.length} 项能力</Text>,
                      children: probeResult.info!.capabilities.map(c => (
                        <div key={c.name} style={{ fontSize: 12, marginBottom: 2 }}>
                          <Text strong>{c.name}</Text>: {c.description}
                        </div>
                      ))
                    }]} />
                  )}
                </>
              ) : (
                <Space>
                  <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                  <Text type="danger">连接失败: {probeResult.error}</Text>
                </Space>
              )}
            </div>
          )}

          <Form.Item name="name" label="显示名称" rules={[{ required: true }]}>
            <Input placeholder="如：Task App" />
          </Form.Item>

          <Form.Item label="认证方式">
            <Form.Item name={['auth', 'type']} noStyle initialValue="none">
              <Input.Group compact>
                {/* 简化：只做 none / bearer 切换 */}
              </Input.Group>
            </Form.Item>
            <Form.Item name={['auth', 'type']} noStyle>
              <Input placeholder="none 或 bearer" style={{ width: 120 }} />
            </Form.Item>
          </Form.Item>
          <Form.Item name={['auth', 'token']} label="Bearer Token（可选）">
            <Input.Password placeholder="留空则不携带 token" />
          </Form.Item>

          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
            <input type="checkbox" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

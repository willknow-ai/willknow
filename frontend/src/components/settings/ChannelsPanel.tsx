import { useState, useEffect } from 'react'
import {
  Button, List, Popconfirm, Modal, Form, Input,
  Space, Typography, Badge, Switch, Select
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  WechatOutlined, LoadingOutlined
} from '@ant-design/icons'
import { v4 as uuidv4 } from 'uuid'
import type { ChannelConfig } from '../../types/config'

const { Text } = Typography

const CHANNEL_TYPES = [
  { value: 'qq', label: 'QQ 机器人', icon: <WechatOutlined /> },
]

const STATUS_MAP: Record<string, { color: 'success' | 'processing' | 'error' | 'default'; text: string }> = {
  connected:    { color: 'success',    text: '已连接' },
  connecting:   { color: 'processing', text: '连接中' },
  disconnected: { color: 'default',    text: '未连接' },
  error:        { color: 'error',      text: '错误' },
}

interface ChannelStatus {
  status: string
  error: string | null
}

interface Props {
  channels: ChannelConfig[]
  onChange: (channels: ChannelConfig[]) => void
}

export default function ChannelsPanel({ channels, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ChannelConfig | null>(null)
  const [form] = Form.useForm()
  const [statusMap, setStatusMap] = useState<Record<string, ChannelStatus>>({})

  // 每 4 秒轮询一次通道状态
  useEffect(() => {
    const poll = () => {
      fetch('/api/channels/status')
        .then(r => r.json())
        .then(data => setStatusMap(data))
        .catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 4000)
    return () => clearInterval(timer)
  }, [])

  const openAdd = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ type: 'qq', enabled: true })
    setOpen(true)
  }

  const openEdit = (ch: ChannelConfig) => {
    setEditing(ch)
    form.setFieldsValue({ ...ch, ...ch.config })
    setOpen(true)
  }

  const onSave = () => {
    form.validateFields().then(values => {
      const { type, name, enabled, appId, appSecret } = values
      const ch: ChannelConfig = {
        id: editing?.id || uuidv4(),
        type,
        name: name || (type === 'qq' ? 'QQ 机器人' : type),
        config: { appId, appSecret },
        enabled: enabled ?? true,
      }
      if (editing) {
        onChange(channels.map(c => c.id === editing.id ? ch : c))
      } else {
        onChange([...channels, ch])
      }
      setOpen(false)
    })
  }

  const onDelete = (id: string) => {
    onChange(channels.filter(c => c.id !== id))
  }

  const onToggle = (id: string, enabled: boolean) => {
    onChange(channels.map(c => c.id === id ? { ...c, enabled } : c))
  }

  return (
    <div>
      <List
        dataSource={channels}
        locale={{ emptyText: '暂无通道，点击下方添加' }}
        renderItem={ch => {
          const st = statusMap[ch.id]
          const statusInfo = STATUS_MAP[st?.status || (ch.enabled ? 'connecting' : 'disconnected')]
          return (
            <List.Item
              actions={[
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(ch)} key="edit" />,
                <Popconfirm title="确认删除？" onConfirm={() => onDelete(ch.id)} key="del">
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                avatar={
                  <Switch
                    size="small"
                    checked={ch.enabled}
                    onChange={v => onToggle(ch.id, v)}
                  />
                }
                title={
                  <Space size={6}>
                    {ch.name}
                    <Badge
                      status={statusInfo.color}
                      text={
                        <Text style={{ fontSize: 11, color: '#8c8c8c' }}>
                          {st?.status === 'connecting' ? <><LoadingOutlined style={{ marginRight: 4 }} />{statusInfo.text}</> : statusInfo.text}
                        </Text>
                      }
                    />
                  </Space>
                }
                description={
                  <Space direction="vertical" size={0}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      AppID: {ch.config?.appId || '未配置'}
                    </Text>
                    {st?.error && (
                      <Text type="danger" style={{ fontSize: 11 }}>
                        {st.error}
                      </Text>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )
        }}
      />
      <Button icon={<PlusOutlined />} onClick={openAdd} block style={{ marginTop: 8 }}>
        添加通道
      </Button>

      <Modal
        title={editing ? '编辑通道' : '添加通道'}
        open={open}
        onOk={onSave}
        onCancel={() => setOpen(false)}
        width={460}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="type" label="通道类型" rules={[{ required: true }]}>
            <Select disabled={!!editing}>
              {CHANNEL_TYPES.map(t => (
                <Select.Option key={t.value} value={t.value}>
                  <Space>{t.icon}{t.label}</Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="name" label="显示名称">
            <Input placeholder="如：我的 QQ 机器人" />
          </Form.Item>

          <Form.Item
            name="appId"
            label="App ID"
            rules={[{ required: true, message: '请输入 App ID' }]}
          >
            <Input placeholder="QQ 开放平台的 App ID" />
          </Form.Item>

          <Form.Item
            name="appSecret"
            label="App Secret"
            rules={[{ required: true, message: '请输入 App Secret' }]}
            extra="在 QQ 开放平台 → 我的应用 → 开发配置 中获取"
          >
            <Input.Password placeholder="App Secret (clientSecret)" />
          </Form.Item>

          <Form.Item name="enabled" label="立即启用" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

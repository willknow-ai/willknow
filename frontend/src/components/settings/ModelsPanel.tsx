import { useState } from 'react'
import {
  Form, Input, Select, Button, List, Tag, Popconfirm, Modal, Typography, Space, Tooltip, Alert
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, StarOutlined, StarFilled,
  CheckCircleOutlined, LoadingOutlined
} from '@ant-design/icons'
import { v4 as uuidv4 } from 'uuid'
import type { ModelConfig } from '../../types/config'

const { Option } = Select
const { Text } = Typography

const PROVIDER_PRESETS: Record<string, { baseURL: string; defaultModel: string; label: string }> = {
  anthropic:         { baseURL: '',                                                    defaultModel: 'claude-sonnet-4-6',    label: 'Anthropic' },
  deepseek:          { baseURL: 'https://api.deepseek.com/v1',                         defaultModel: 'deepseek-chat',       label: 'DeepSeek' },
  qwen:              { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',   defaultModel: 'qwen-plus',           label: '通义千问 (Qwen)' },
  moonshot:          { baseURL: 'https://api.moonshot.cn/v1',                          defaultModel: 'moonshot-v1-8k',      label: 'Moonshot' },
  openai:            { baseURL: 'https://api.openai.com/v1',                           defaultModel: 'gpt-4o',              label: 'OpenAI' },
  siliconflow:       { baseURL: 'https://api.siliconflow.cn/v1',                       defaultModel: 'deepseek-ai/DeepSeek-V3', label: 'SiliconFlow' },
  custom:            { baseURL: '',                                                    defaultModel: '',                    label: '自定义' },
}

interface Props {
  models: ModelConfig[]
  onChange: (models: ModelConfig[]) => void
}

type ProbeStatus = 'idle' | 'probing' | 'ok' | 'error'

export default function ModelsPanel({ models, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ModelConfig | null>(null)
  const [form] = Form.useForm()
  const [selectedPreset, setSelectedPreset] = useState<string>('deepseek')
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>('idle')
  const [probeError, setProbeError] = useState<string>('')

  const resetProbe = () => {
    setProbeStatus('idle')
    setProbeError('')
  }

  const openAdd = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ provider: 'openai_compatible', preset: 'deepseek', ...PROVIDER_PRESETS['deepseek'] })
    setSelectedPreset('deepseek')
    resetProbe()
    setOpen(true)
  }

  const openEdit = (m: ModelConfig) => {
    setEditing(m)
    const preset = Object.entries(PROVIDER_PRESETS).find(([, p]) => p.baseURL === m.baseURL)?.[0] || 'custom'
    setSelectedPreset(preset)
    form.setFieldsValue({ ...m, preset })
    resetProbe()
    setOpen(true)
  }

  const onPresetChange = (preset: string) => {
    setSelectedPreset(preset)
    const p = PROVIDER_PRESETS[preset]
    form.setFieldsValue({
      provider: preset === 'anthropic' ? 'anthropic' : 'openai_compatible',
      baseURL: p.baseURL,
      model: p.defaultModel,
    })
    resetProbe()
  }

  const onSave = async () => {
    let values: Record<string, string>
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    const { preset: _preset, ...rest } = values

    // 测试连通性
    setProbeStatus('probing')
    setProbeError('')
    try {
      const r = await fetch('/api/models/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rest),
      })
      const data = await r.json()
      if (!data.ok) {
        setProbeStatus('error')
        setProbeError(data.error || '连接失败')
        return
      }
    } catch (err) {
      setProbeStatus('error')
      setProbeError((err as Error).message)
      return
    }

    setProbeStatus('ok')

    // 短暂显示成功后保存关闭
    setTimeout(() => {
      if (editing) {
        onChange(models.map(m => m.id === editing.id ? { ...m, ...rest } : m))
      } else {
        const newModel = { id: uuidv4(), isDefault: models.length === 0, ...rest } as ModelConfig
        onChange([...models, newModel])
      }
      setOpen(false)
      resetProbe()
    }, 600)
  }

  const onDelete = (id: string) => {
    const next = models.filter(m => m.id !== id)
    if (next.length > 0 && !next.find(m => m.isDefault)) next[0].isDefault = true
    onChange(next)
  }

  const setDefault = (id: string) => {
    onChange(models.map(m => ({ ...m, isDefault: m.id === id })))
  }

  const okText = probeStatus === 'probing' ? '测试中...' : probeStatus === 'ok' ? '已连接 ✓' : '测试并保存'

  return (
    <div>
      <List
        dataSource={models}
        locale={{ emptyText: '暂无模型，点击下方添加' }}
        renderItem={m => (
          <List.Item
            actions={[
              <Tooltip title={m.isDefault ? '默认模型' : '设为默认'} key="default">
                <Button
                  type="text" size="small"
                  icon={m.isDefault ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                  onClick={() => setDefault(m.id)}
                />
              </Tooltip>,
              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(m)} key="edit" />,
              <Popconfirm title="确认删除？" onConfirm={() => onDelete(m.id)} key="del">
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={<Space>{m.name}{m.isDefault && <Tag color="gold">默认</Tag>}</Space>}
              description={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {m.model} · API Key: {m.apiKey ? m.apiKey.slice(0, 8) + '****' : '未配置'}
                </Text>
              }
            />
          </List.Item>
        )}
      />
      <Button icon={<PlusOutlined />} onClick={openAdd} block style={{ marginTop: 8 }}>
        添加模型
      </Button>

      <Modal
        title={editing ? '编辑模型' : '添加模型'}
        open={open}
        onOk={onSave}
        onCancel={() => { setOpen(false); resetProbe() }}
        okText={okText}
        okButtonProps={{ loading: probeStatus === 'probing', disabled: probeStatus === 'ok' }}
        width={480}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="显示名称" rules={[{ required: true }]}>
            <Input placeholder="如：DeepSeek V3" onChange={resetProbe} />
          </Form.Item>
          <Form.Item name="preset" label="服务商">
            <Select onChange={onPresetChange}>
              {Object.entries(PROVIDER_PRESETS).map(([k, v]) => (
                <Option key={k} value={k}>{v.label}</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="provider" hidden><Input /></Form.Item>
          {selectedPreset !== 'anthropic' && (
            <Form.Item name="baseURL" label="API Base URL" rules={[{ required: true }]}>
              <Input placeholder="https://api.deepseek.com/v1" onChange={resetProbe} />
            </Form.Item>
          )}
          <Form.Item name="model" label="模型名称" rules={[{ required: true }]}>
            <Input placeholder="如：deepseek-chat" onChange={resetProbe} />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]} style={{ marginBottom: probeStatus === 'idle' ? undefined : 8 }}>
            <Input.Password placeholder="sk-..." onChange={resetProbe} />
          </Form.Item>

          {/* 连通性测试结果 */}
          {probeStatus === 'probing' && (
            <Alert message={<Space size={6}><LoadingOutlined />正在测试连通性...</Space>} type="info" showIcon={false} />
          )}
          {probeStatus === 'ok' && (
            <Alert message={<Space size={6}><CheckCircleOutlined />连接成功</Space>} type="success" showIcon={false} />
          )}
          {probeStatus === 'error' && (
            <Alert message="连接失败" description={probeError} type="error" showIcon />
          )}
        </Form>
      </Modal>
    </div>
  )
}

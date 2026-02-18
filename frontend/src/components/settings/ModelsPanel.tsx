import { useState } from 'react'
import {
  Form, Input, Select, Button, List, Tag, Popconfirm, Modal, Typography, Space, Tooltip
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, StarOutlined, StarFilled } from '@ant-design/icons'
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

export default function ModelsPanel({ models, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ModelConfig | null>(null)
  const [form] = Form.useForm()
  const [selectedPreset, setSelectedPreset] = useState<string>('deepseek')

  const openAdd = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ provider: 'openai_compatible', preset: 'deepseek', ...PROVIDER_PRESETS['deepseek'] })
    setSelectedPreset('deepseek')
    setOpen(true)
  }

  const openEdit = (m: ModelConfig) => {
    setEditing(m)
    const preset = Object.entries(PROVIDER_PRESETS).find(([, p]) => p.baseURL === m.baseURL)?.[0] || 'custom'
    setSelectedPreset(preset)
    form.setFieldsValue({ ...m, preset })
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
  }

  const onSave = () => {
    form.validateFields().then(values => {
      const { preset, ...rest } = values
      if (editing) {
        onChange(models.map(m => m.id === editing.id ? { ...m, ...rest } : m))
      } else {
        const newModel: ModelConfig = { id: uuidv4(), isDefault: models.length === 0, ...rest }
        onChange([...models, newModel])
      }
      setOpen(false)
    })
  }

  const onDelete = (id: string) => {
    const next = models.filter(m => m.id !== id)
    // 如果删的是默认，把第一个设为默认
    if (next.length > 0 && !next.find(m => m.isDefault)) next[0].isDefault = true
    onChange(next)
  }

  const setDefault = (id: string) => {
    onChange(models.map(m => ({ ...m, isDefault: m.id === id })))
  }

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

      <Modal title={editing ? '编辑模型' : '添加模型'} open={open} onOk={onSave} onCancel={() => setOpen(false)} width={480}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="显示名称" rules={[{ required: true }]}>
            <Input placeholder="如：DeepSeek V3" />
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
              <Input placeholder="https://api.deepseek.com/v1" />
            </Form.Item>
          )}
          <Form.Item name="model" label="模型名称" rules={[{ required: true }]}>
            <Input placeholder="如：deepseek-chat" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]}>
            <Input.Password placeholder="sk-..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

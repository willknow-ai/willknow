import { Typography, Space } from 'antd'
import { ClockCircleOutlined } from '@ant-design/icons'

const { Text, Title } = Typography

interface Props {
  title: string
  description: string
}

export default function ComingSoonPanel({ title, description }: Props) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8c8c8c' }}>
      <Space direction="vertical" size={12} align="center">
        <ClockCircleOutlined style={{ fontSize: 40, color: '#d9d9d9' }} />
        <Title level={5} style={{ color: '#8c8c8c', margin: 0 }}>{title}（即将推出）</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>{description}</Text>
      </Space>
    </div>
  )
}

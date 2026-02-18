# willknow

通用 AI 对话机器人客户端，支持多模型、多通道和 SubAgent 协作。

## 功能特性

- **多模型支持** — 接入 Anthropic Claude 及任意 OpenAI-compatible 接口（DeepSeek、Qwen 等）
- **SubAgent 协作** — 将实现了 willknow 协议的外部服务自动注册为 LLM tool，LLM 按需调用，实现 A2A 协作
- **流式对话** — SSE 实时输出，工具调用过程可视化展示
- **多通道接入** — 支持 QQ 机器人（群消息 + 私聊），更多通道持续扩展
- **可视化管理** — 内置设置页面，管理模型、通道、SubAgent 配置，无需手动编辑配置文件

## 目录结构

```
willknow/
├── backend/                    # Node.js + Express 后端
│   └── src/
│       ├── index.js            # 服务入口
│       ├── config/
│       │   └── config.json     # 运行时配置（模型/通道/SubAgents）
│       ├── routes/
│       │   ├── chat.js         # POST /api/chat（SSE 流式）
│       │   └── settings.js     # GET/PUT /api/settings
│       └── services/
│           ├── llm.js          # LLM 调用 + tool calling 循环
│           ├── subagent.js     # SubAgent 探测与调用
│           └── channels/
│               ├── manager.js  # 通道生命周期管理
│               └── qq.js       # QQ 机器人通道
└── frontend/                   # React + Ant Design + Vite 前端
    └── src/
        ├── pages/
        │   ├── Chat.tsx        # 对话页
        │   └── Settings.tsx    # 设置页
        ├── components/settings/
        │   ├── ModelsPanel.tsx
        │   ├── ChannelsPanel.tsx
        │   └── SubAgentsPanel.tsx
        └── types/config.ts     # 配置类型定义
```

## 快速启动

**前置要求：** Node.js 18+

```bash
# 启动后端
cd backend
npm install
npm run dev    # 监听 http://localhost:3000

# 启动前端（新终端）
cd frontend
npm install
npm run dev    # 监听 http://localhost:5173
```

打开浏览器访问 http://localhost:5173，进入设置页面配置模型后即可开始对话。

## 配置说明

所有配置通过界面操作，保存至 `backend/src/config/config.json`。

### 模型配置

支持两种 provider：

| provider | 说明 | 必填字段 |
|---|---|---|
| `anthropic` | Anthropic Claude 系列 | API Key |
| `openai_compatible` | OpenAI 兼容接口 | API Key、Base URL、模型名 |

可配置多个模型，勾选"默认"的模型用于所有对话。

### SubAgent 配置

SubAgent 是实现了 willknow 协议的外部服务。每个 SubAgent 会被自动注册为 LLM 的一个 tool，由 LLM 决定何时调用。

**配置步骤：**
1. 在设置页 SubAgents 面板填入服务地址，点击「探测」
2. 探测成功后自动填充名称，保存即可
3. 下次对话时 LLM 即可感知并调用该 SubAgent

**支持的认证方式：**
- `none` — 无认证
- `bearer` — Bearer Token（添加 `Authorization: Bearer <token>` 请求头）

### QQ 机器人配置

1. 在 [QQ 开放平台](https://q.qq.com/) 创建机器人应用
2. 在设置页 Channels 面板添加通道，填入 App ID 和 App Secret
3. 保存后自动连接，状态变为「已连接」即可

**所需权限：** 群消息（GROUP_AT_MESSAGE_CREATE）、私聊消息（C2C_MESSAGE_CREATE）

## willknow 协议

任何服务只需实现以下两个接口即可作为 SubAgent 接入：

### `GET /willknow/info`

返回服务能力描述，willknow 据此为 LLM 生成 tool 定义。

```json
{
  "name": "Task Management API",
  "description": "管理任务的创建、查询和更新",
  "capabilities": [
    { "name": "create_task", "description": "创建新任务" },
    { "name": "list_tasks",  "description": "查询任务列表" },
    { "name": "update_task", "description": "更新任务状态" }
  ]
}
```

### `POST /willknow/chat`

接收自然语言指令并执行，支持 session 以维护上下文。

**请求：**
```json
{
  "message": "帮我创建一个任务：部署 v2.0",
  "session_id": "optional-session-id"
}
```

**响应：**
```json
{
  "message": "任务已创建，ID 为 42，标题：部署 v2.0",
  "session_id": "session-id-for-next-turn"
}
```

Go 语言实现参考：[willknow-go](../willknow-go)

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/chat` | SSE 流式对话 |
| `GET` | `/api/settings` | 读取全部配置 |
| `PUT` | `/api/settings` | 保存全部配置 |
| `POST` | `/api/subagents/probe` | 探测 SubAgent 连通性 |
| `GET` | `/api/channels/status` | 查询通道连接状态 |

### POST /api/chat

**请求体：**
```json
{
  "message": "用户消息",
  "conversationId": "可选，对话 ID",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**SSE 事件流：**
```
data: {"type":"text","content":"正在处理..."}
data: {"type":"tool_call","tool":"subagent_xxx","agentName":"Task App","input":"创建任务"}
data: {"type":"tool_result","tool":"subagent_xxx","content":"任务已创建"}
data: {"type":"text","content":"任务创建成功。"}
data: {"type":"done"}
```

## 技术栈

- **后端：** Node.js、Express、ws、node-fetch
- **前端：** React 18、TypeScript、Ant Design 5、Vite
- **持久化：** JSON 文件
- **流式传输：** Server-Sent Events (SSE)

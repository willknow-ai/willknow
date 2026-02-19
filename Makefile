BACKEND_IMAGE  := willknow-backend
FRONTEND_IMAGE := willknow-frontend

.PHONY: build build-backend build-frontend up down logs dev dev-backend dev-frontend

# ── Docker ────────────────────────────────────────────────────────────────────

## 构建所有镜像
build: build-backend build-frontend

## 构建后端镜像
build-backend:
	docker build -t $(BACKEND_IMAGE) ./backend

## 构建前端镜像
build-frontend:
	docker build -t $(FRONTEND_IMAGE) ./frontend

## 一键启动（前台，Ctrl+C 停止）
up: _ensure-data
	docker compose up

## 后台启动
up-detach: _ensure-data
	docker compose up -d

## 停止并移除容器
down:
	docker compose down

## 查看实时日志
logs:
	docker compose logs -f

## 重新构建并启动（代码变更后使用）
rebuild: build up-detach

# ── 本地开发 ──────────────────────────────────────────────────────────────────

## 本地开发模式（同时启动后端和前端，需先 npm install）
dev:
	@echo "▶ 启动后端（http://localhost:3000）..."
	@cd backend && npm run dev &
	@echo "▶ 启动前端（http://localhost:5173）..."
	@cd frontend && npm run dev

## 仅启动后端（本地开发）
dev-backend:
	cd backend && npm run dev

## 仅启动前端（本地开发）
dev-frontend:
	cd frontend && npm run dev

## 安装所有依赖
install:
	cd backend && npm install
	cd frontend && npm install

# ── 内部 ──────────────────────────────────────────────────────────────────────

_ensure-data:
	@mkdir -p data
	@if [ ! -f data/config.json ]; then \
		echo '{"models":[],"channels":[],"skills":[],"subAgents":[]}' > data/config.json; \
		echo "✓ 已创建默认配置 data/config.json"; \
	fi

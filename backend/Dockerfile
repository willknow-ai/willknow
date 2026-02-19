FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

# 确保配置目录存在（实际 config.json 由外部挂载卷提供）
RUN mkdir -p /app/src/config

EXPOSE 3000

# 启动时若配置文件不存在则写入空配置（防止首次挂载卷为空时报错）
CMD ["sh", "-c", "\
  if [ ! -f /app/src/config/config.json ]; then \
    echo '{\"models\":[],\"channels\":[],\"skills\":[],\"subAgents\":[]}' > /app/src/config/config.json; \
  fi && \
  node src/index.js"]

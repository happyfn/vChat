# vChat

Linux 友好的 Web 多人聊天：服务器/频道树、文字聊天、WebRTC 语音频道（类似 KOOK 的基础形态）。

技术栈：React + Vite 前端，Node.js + Fastify + Socket.IO + SQLite + mediasoup。

## 依赖

- Node.js >= 20
- 编译 mediasoup 需要：`build-essential`、`python3`

```bash
# Ubuntu / Debian 示例
sudo apt install -y build-essential python3
```

## 启动

```bash
npm install
npm run dev
```

- 前端：http://127.0.0.1:5173
- 后端：http://127.0.0.1:3000（开发时由 Vite 代理 `/api` 与 `/socket.io`）

## 公网互联

服务端默认监听 `0.0.0.0:3000`。跨网语音需配置 mediasoup 通告 IP：

```bash
export MEDIASOUP_ANNOUNCED_IP=你的公网IP
export JWT_SECRET=换成随机字符串
export PORT=3000
npm run dev -w server
```

前端若与 API 不同源：

```bash
export VITE_API_URL=https://api.example.com
export VITE_WS_URL=https://api.example.com
npm run dev -w client
```

浏览器采集麦克风需要 **HTTPS** 或 **localhost**。公网建议用 Nginx/Caddy 反代并启用 TLS。  
UDP 端口范围默认 `40000-40100`（可用 `MEDIASOUP_MIN_PORT` / `MEDIASOUP_MAX_PORT` 调整），防火墙需放行。

## 功能

- 注册 / 登录（JWT）
- 创建服务器、邀请码加入
- 文字频道实时聊天
- 语音频道加入 / 静音 / 离开
- 在线成员与所在语音状态

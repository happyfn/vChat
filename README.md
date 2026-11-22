# vChat

Linux 友好的 Web 多人聊天：服务器/频道树、文字聊天、WebRTC 语音频道（类似 KOOK 的基础形态）。

技术栈：React + Vite 前端，Node.js + Fastify + Socket.IO + SQLite + mediasoup。

## 依赖

- Node.js >= 22（当前锁定的 mediasoup / mediasoup-client 依赖要求）
- 编译 mediasoup 需要：`build-essential`、`python3`

```bash
# Ubuntu / Debian 示例
sudo apt install -y build-essential python3
```

## 本地开发

以下项目命令均在仓库根目录执行。

```bash
npm ci
npm run dev
```

- 前端：http://127.0.0.1:5173
- 后端：http://127.0.0.1:3000（开发时由 Vite 代理 `/api` 与 `/socket.io`）

浏览器在 `localhost` 或 `127.0.0.1` 上可以申请麦克风权限；其他设备通过普通 HTTP 局域网地址打开网页时，通常无法使用麦克风，需要 HTTPS。

## 家用电脑公网部署

可以用家用电脑运行服务端，让自己和其他家庭网络中的用户通过浏览器聊天，无需租用云服务器。电脑必须保持开机、联网，语音会经过这台电脑转发，人数和通话质量受上行带宽、网络延迟及机器性能影响。

文字与语音使用不同的连接，只有网页能打开还不代表语音可用：

```text
浏览器 ── HTTPS / WebSocket ── Caddy ── 网页文件、Node.js 后端
浏览器 ── WebRTC UDP / TCP ─────────── mediasoup 语音服务
```

### 1. 确认公网入口

下面的操作以 **Linux、本机运行后端和 Caddy、有公网 IPv4、可以配置路由器** 为前提。

查看路由器的 WAN 地址，并与家中网络查询到的出口 IPv4 比较。`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16` 是私网地址，`100.64.0.0/10` 是运营商常用的共享地址段，均不能直接作为公网入口。

如果前面还有光猫或另一台路由器，需要检查最外层设备，并处理每一层端口转发，或调整为桥接。如果最外层仍是运营商 NAT，可询问运营商能否提供支持入站连接的公网 IPv4。公网地址也不保证所有端口可用，仍需检查入站限制和实际连通性。

| 网络条件 | 部署方式 |
| --- | --- |
| 有可入站的公网 IPv4 | 按下面步骤配置 HTTPS 和端口转发 |
| 只有公网 IPv6 | 配置 IPv6 监听、媒体通告地址、DNS AAAA 和防火墙；参与者必须具备 IPv6 连通性 |
| 没有可入站的公网地址，允许安装组网软件 | 可用 Tailscale 等组网，媒体通告地址使用服务端的虚拟网络地址，网页仍需 HTTPS |
| 没有公网入口，参与者只使用浏览器 | 需要同时解决网页与媒体可达性的公网中转；仅在本地启动项目不够 |

普通 HTTP 内网穿透只解决网页和信令入口，不会自动转发本项目的 WebRTC 媒体端口。虚拟组网可以免租服务器，但仍可能依赖第三方协调或中继服务。

### 2. 固定内网地址并转发端口

在路由器中为服务端电脑设置 DHCP 地址保留，例如 `192.168.1.100`，再配置以下转发。电脑防火墙也需放行对应端口。

| 外部端口 | 本机目标 | 用途 |
| --- | --- | --- |
| TCP `80` | `192.168.1.100:80` | HTTP 跳转、证书验证 |
| TCP `443` | `192.168.1.100:443` | HTTPS 网页、API、Socket.IO |
| UDP `40000–40100` | `192.168.1.100` 的相同端口范围 | WebRTC 语音，优先使用 |
| TCP `40000–40100` | `192.168.1.100` 的相同端口范围 | 已启用的 WebRTC TCP 通道 |

媒体端口应保持外部端口与本机端口一致，因为当前代码通告的是本机媒体端口。使用下面的同机反向代理方案时，无需向公网映射 `3000` 或开发服务器的 `5173`。

### 3. 配置域名和后端

准备一个可控制 DNS 的域名或子域名，例如 `chat.example.com`，将其 `A` 记录指向家中的公网 IPv4。以下示例域名、地址和路径均需替换为实际值。

首次部署时创建配置文件；已有 `.env` 时直接编辑，避免覆盖原有配置：

```bash
cp .env.example .env
```

根目录 `.env` 的部署配置示例：

```dotenv
HOST=127.0.0.1
PORT=3000
JWT_SECRET=替换为随机生成的长密钥
DB_PATH=./server/data/vchat.sqlite
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=替换为家中的公网IPv4
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=40100
```

用 `openssl rand -hex 32` 生成密钥，填入 `JWT_SECRET` 并保存，后续启动保持不变。不要使用示例中的默认密钥。

`HOST` 控制 HTTP 后端监听地址，`MEDIASOUP_LISTEN_IP` 控制语音监听地址，两者独立。`MEDIASOUP_ANNOUNCED_IP` 是告知浏览器的媒体连接地址，公网部署不能保留 `.env.example` 中的 `127.0.0.1`，也不能填写 `0.0.0.0` 或普通内网地址。设置它本身不会完成端口映射。

安装、构建并启动：

```bash
npm ci
npm run build
node --env-file=.env server/dist/index.js
```

当前后端不会自动读取根目录 `.env`，因此使用 `--env-file` 显式加载。`DB_PATH` 的相对路径按进程工作目录解析，启动命令必须在仓库根目录执行。`npm start` 仅启动后端，既不自动加载该文件，也不提供前端静态网页。

### 4. 使用 Caddy 提供 HTTPS 网页

按 [Caddy 官方安装说明](https://caddyserver.com/docs/install) 安装。以下以官方 Debian/Ubuntu 软件包提供的 `caddy` 系统服务为例，将配置写入 `/etc/caddy/Caddyfile`：

```caddyfile
chat.example.com {
    @backend path /api/* /socket.io/*

    handle @backend {
        reverse_proxy 127.0.0.1:3000
    }

    handle {
        root * /srv/vchat/client/dist
        try_files {path} /index.html
        file_server
    }
}
```

将 `/srv/vchat/client/dist` 替换为实际构建目录的绝对路径，并确保 Caddy 服务用户可以遍历其父目录、读取网页文件。这里只发布 `client/dist`，不要把仓库根目录作为静态站点目录。

校验配置并启动或重新加载服务：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

域名解析正确、TCP `80` / `443` 可从公网到达且本机端口可用时，Caddy 会自动申请和续期证书，并代理 WebSocket。此默认方案假设这些端口可用；运营商封锁端口时需要另行配置入口和证书验证方式。参见 [Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https) 和 [反向代理与静态站点示例](https://caddyserver.com/docs/caddyfile/patterns)。

浏览器远程采集麦克风需要可信的 HTTPS 页面，不能仅将地址写成 `http://公网IP`。参见 [getUserMedia 安全上下文要求](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。

上述方案中网页、API 和 Socket.IO 同源，构建前端时保持 `VITE_API_URL`、`VITE_WS_URL` 未设置，也移除 `client/.env*` 中旧的地址覆盖。只有分别部署前端和后端时才设置它们，并重新构建：

```bash
export VITE_API_URL=https://api.example.com
export VITE_WS_URL=https://api.example.com
npm run build -w client
```

### 5. 验证访问并保持服务运行

1. 用其他家庭网络，或关闭 Wi-Fi 后使用移动网络，访问 `https://你的域名`，确认网页没有证书错误。
2. 注册账号、创建服务器并分享邀请码，让另一个账号加入，验证文字消息。
3. 两端进入同一语音频道，允许麦克风权限，验证双向声音；网页可访问不能替代语音验证。
4. 再从服务端所在的家中网络加入，验证自己与外网用户可以同时通话。

后端命令目前在前台运行，退出进程就会停止聊天服务。长期使用可将其交给 systemd 等进程管理器，保持工作目录为仓库根目录，并显式加载 `.env`；同时保持 Caddy 运行、电脑不休眠。数据默认位于 `server/data/`，可停服后备份该目录。

### 常见问题与当前限制

| 现象 | 检查项 |
| --- | --- |
| 外网网页打不开 | 公网入口、DNS、光猫与路由器转发、电脑防火墙、Caddy 服务 |
| 网页能打开，登录或聊天失败 | 后端是否启动、`/api/*` 和 `/socket.io/*` 是否正确代理、前端是否残留旧的构建地址 |
| 无法申请麦克风权限 | 是否使用可信 HTTPS、浏览器和系统是否允许麦克风 |
| 文字正常，语音不通 | 媒体通告 IP 是否正确、UDP/TCP 媒体端口是否按原端口映射和放行 |
| 朋友正常，自己在家访问或语音失败 | 路由器是否支持 NAT 回环，以及下面说明的局域网媒体地址限制 |
| 换 IP 后无法连接 | 更新 DNS/DDNS 和 `.env` 中的媒体通告 IP，重启后端并重新加入语音 |

当前 [语音实现](server/src/voice.ts) 只配置一个媒体通告地址。通告公网 IP 后，家中客户端连接同一服务可能依赖路由器的 NAT 回环。如果不支持，可用本地 DNS 解决网页域名的访问；语音还需要修改媒体配置，同时提供公网和局域网候选地址，单独修改 DNS 无法解决。当前版本尚未自动处理这种情况，参见 [mediasoup 地址配置](https://mediasoup.org/documentation/v3/mediasoup/api/)。

对于具备公网入口、端口连通且支持上述访问方式的网络，现有聊天业务代码无需改动，完成部署配置即可。动态公网 IP、IPv4/IPv6 双栈和不支持 NAT 回环的网络，需要按实际情况补充配置或媒体地址处理。

## 功能

- 注册 / 登录（JWT）
- 创建服务器、邀请码加入
- 文字频道实时聊天
- 语音频道加入 / 静音 / 离开
- 在线成员与所在语音状态

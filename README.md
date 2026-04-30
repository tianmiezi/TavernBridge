# Tavern Bridge

把微信 ClawBot / OpenClaw 消息转进 SillyTavern 指定角色聊天，再把角色回复发回微信。

这个项目是一个 SillyTavern 第三方扩展，目录里自带本地伴生服务。用户只需要把整个文件夹放进 SillyTavern 扩展目录，然后按步骤登录微信即可。

## 功能

- 微信 ClawBot 登录、收消息、发文本。
- 酒馆前端接收微信事件，写入当前/目标角色聊天。
- 酒馆生成回复后提取 `<message>...</message>` 正文。
- 支持多条 `<message>` 分开发送。
- 支持定时任务、一周任务表、未回复后续提醒。
- 支持固定时间与每日随机时间窗触发。
- 支持失败、延迟、重发队列。
- 支持多个机器人绑定：每个 `Bot ID` 对应一个酒馆窗口/角色。
- 独立管理页：`http://127.0.0.1:8790`。

## 安装

把本项目放到：

```text
SillyTavern/public/scripts/extensions/third-party/CodexTavernBridge
```

需要 Node.js 24+。

## 登录微信

首次使用先登录微信。

双击：

```text
TavernBridge/login-wechat.bat
```

或者手动运行：

```powershell
cd TavernBridge/server
npm run login
```

命令会生成二维码：

```text
%USERPROFILE%\.codexbridge-weixin\weixin\login\weixin-qr.png
```

用微信扫码。成功后，管理页里的“机器人绑定 -> 微信账号”下拉框会出现已保存账号。

## 启动

登录完成后，双击：

```text
TavernBridge/start-bridge.bat
```

它会自动进入 `server/`，执行 `npm install`，然后启动两个本地服务：

```text
http://127.0.0.1:8787  酒馆前端事件通道
http://127.0.0.1:8790  管理网页
```

如果想手动启动：

```powershell
cd TavernBridge/server
npm install
npm start
```

## 基本使用

1. 启动 SillyTavern。
2. 打开你要使用的角色聊天。
3. 在扩展设置里找到 `酒馆桥接`。
4. 桥接地址填：

```text
http://127.0.0.1:8787
```

5. `Bot ID` 填管理页里对应的机器人 ID，例如：

```text
default
```

6. 点击“连接桥接”。
7. 微信里通过 ClawBot 发消息。
8. 酒馆角色生成回复后，会自动回发微信。

## 管理页

打开：

```text
http://127.0.0.1:8790
```

可以配置：

- 机器人绑定。
- 微信账号选择。
- 目标微信联系人 / Scope ID。
- 目标酒馆角色与会话标识。
- 发送模式：按 `<message>` 分条或合并。
- 一周定时任务。
- 未回复后续提醒。
- 发送记录、失败重发、清理队列。

## 机器人绑定

`Bot ID` 是内部路由名。多个酒馆窗口并行时，每个窗口填不同的 `Bot ID`。

示例：

```text
窗口 A：Bot ID = morning
窗口 B：Bot ID = study
```

管理页里创建对应绑定：

```json
{
  "id": "study",
  "name": "学习提醒",
  "wechat_account_id": "your_saved_wechat_bot_account",
  "wechat_scope_id": "",
  "target_character": "girlfriend_study_partner",
  "conversation_id": "daily_study_checkin",
  "language": "zh-CN"
}
```

任务里选择 `study` 后，只会投递到订阅了 `study` 的酒馆窗口。

## 角色输出格式

建议在角色卡或世界书里约束回复格式：

```text
<message>第一条微信消息</message>
<message>第二条微信消息</message>
```

扩展会提取所有 `<message>` 标签，并把每条分开发送给微信。管理页也可以切换成合并模式。

## 注意

- SillyTavern 页面必须打开，扩展必须连接。角色生成依赖 ST 前端上下文。
- 本地伴生服务必须保持运行。
- 微信 ClawBot / OpenClaw 的入口不是普通微信好友列表里的多个机器人联系人；同一个微信号通常只有一个 ClawBot 入口。
- 如果想在一个大号里看到多个“联系人式机器人”，通常需要小号转发方案；本扩展当前优先支持 ClawBot 单入口和后端多角色路由。
- 本拓展暂时还未实现单主账号对应多联系人的功能，有需要的朋友，请静待更新

真实微信登录态保存在：

```text
%USERPROFILE%\.codexbridge-weixin
```

      tavern-relay.config.example.json
```

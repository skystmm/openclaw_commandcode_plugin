# Command Code Go for OpenClaw

面向 **OpenClaw 2026.10.7**、仅适配 **Command Code Go 套餐**的独立模型 provider 插件。使用你自己的 Go 账号 key，通过 `/alpha/generate` CLI HTTP 协议生成内容。工具由 OpenClaw 执行，插件负责消息和流协议转换。其他套餐及标准 Provider API 请使用对应的官方集成。

这是社区适配。Go 官方不包含标准 Provider API；拿到 key 不会增加套餐或模型权限。真实 Go 账号的当前可用性与额度扣减仍需实测。

## 安装

要求与 OpenClaw 2026.10.7 相同：Node.js `>=24.22.1 <25` 或 `>=26.12.1`。

先从本仓库构建安装包：

```bash
git clone https://github.com/skystmm/openclaw_commandcode_plugin.git
cd openclaw_commandcode_plugin
npm ci
npm run build
npm pack
```

然后安装生成的包：

```bash
openclaw plugins install /absolute/path/openclaw-commandcode-go-0.1.2.tgz
```

按 CLI 提示审核本地来源并确认安装。配置键为 `commandcode-go`，模型 provider 为 `commandcode`。如果你已经安装了另一个注册 `commandcode` 的插件，请先解决 provider 重名。

本地包会显示来源未验证的 provenance 警告；这是尚未经 npm/ClawHub 发布验证的开发包。

从 GitHub 安装后，更新命令为 `openclaw plugins update commandcode-go`，然后重启 Gateway。

开发目录安装（先构建）：

```bash
npm ci
npm run build
openclaw plugins install --link /absolute/path/openclaw_commandcode_plugin
```

## 配置 key 与模型

最简单的方式是给 Gateway 启动环境提供 key：

```bash
export COMMANDCODE_API_KEY='你的账号 key'
```

也识别官方 CLI 的环境变量名 `COMMAND_CODE_API_KEY`；两者同时存在时前者优先。通过服务管理器启动的 Gateway 需要在该服务自己的启动环境设置变量。

或者让 OpenClaw 保存 API-key auth profile：

```bash
openclaw models auth login --provider commandcode --method api-key
```

将以下片段合入现有 OpenClaw 配置，不要覆盖整份配置；已有 `plugins.allow` 时将 `commandcode-go` 加入原列表：

```json
{
  "plugins": {
    "allow": ["commandcode-go"],
    "entries": {
      "commandcode-go": {
        "enabled": true,
        "config": {
          "models": ["deepseek/deepseek-v4.1-flash"],
          "contextWindow": 131072,
          "maxOutputTokens": 32768,
          "requestTimeoutMs": 300000,
          "streamIdleTimeoutMs": 300000,
          "zdr": false
        }
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "commandcode/deepseek/deepseek-v4.1-flash" }
    }
  }
}
```

如果你已有模型 allowlist，也要加入该模型。按你的运行方式重启或重载 Gateway，再检查：

```bash
openclaw plugins inspect commandcode-go
openclaw plugins doctor
openclaw models list
```

默认使用已在上游快照列为 Go 的 DeepSeek V4.1 Flash；服务器决定实际权限。`models` 可以显式改为其他模型的完整 Command Code id，但这不会解锁套餐外模型。首版不做实时模型目录同步，默认窗口保守设为 128K，输出上限设为 32K；按你使用的模型能力调整。

## key 从哪里来

可以在 Command Code Studio 的 API Keys 页面创建，或者安装官方 CLI 后执行：

```bash
npm i -g command-code@latest
cmd login
```

官方 CLI 登录会将凭据写入 `~/.commandcode/auth.json`。本插件不会自动读取该文件；请通过上面的 auth 命令或环境变量配置。不要把凭据文件、key 或 `.env` 提交到仓库。Windows 使用 `cmdc login`。

官方参考：[快速入门](https://commandcode.ai/docs/quickstart)、[Go 套餐](https://commandcode.ai/docs/plans/go)。

## 支持与限制

- 支持文本、多轮、思考内容、工具调用和结果回传、稳定会话 UUID、SSE 增量、取消及连接/空闲超时。
- 流内错误、缺失 finish 和不完整工具调用会终止为错误；不自动重发，不切换到 Provider API，也不切换其他账号。
- 默认模型的 `minimal/medium/xhigh` 分别映射到其支持的 `low/high/max`。可设置 `reasoningEffort` 显式指定；其他模型需选择其支持的档位。
- `zdr: true` 会始终发送 `x-cmd-zdr: 1`；失败不会偷偷关闭。ZDR 可能改变可用上游与额度计量。
- 不支持图片、网页搜索、浏览器登录、多账号轮换或余额看板。图片输入、非 object 根工具 schema、stop sequences 与 responseFormat 会明确报错。
- 用量返回输入、输出和缓存 token；**首版没有价格目录，OpenClaw 中的零费用估算表示未知，不能视为免费或剩余额度**。以 Studio 账单为准。
- `apiBase` 可指向你信任的 HTTPS origin，或用于测试的 loopback HTTP。该地址会收到 key 与会话内容。生成请求不跟随重定向。
- v0.1.2 使用宿主的 `pi-messages` 原生传输槽，普通轮次和辅助补全都走 CLI 协议。专用传输不可用时停止请求，不退回 OpenAI-compatible API。
- 已保存的 `commandcode` 模型即使仍标为 `openai-completions`、URL 仍是 `/provider/v1`，也会在运行时归一化为 Go CLI 传输；不删除或覆盖你的配置、key profile。请勿为了 Go 套餐另建普通 OpenAI-compatible provider。

## 升级到 Go 专用传输（v0.1.2）

```bash
openclaw plugins update commandcode-go
openclaw gateway restart
openclaw plugins inspect commandcode-go
```

确认版本为 `0.1.2`。模型引用仍为 `commandcode/deepseek/deepseek-v4.1-flash`，原 `commandcode:default` key profile 继续使用。在需要切换的现有聊天里执行 `/model commandcode/deepseek/deepseek-v4.1-flash -s`。

该版本解决了把 Go 模型标成普通 API 的回退风险。本地测试用“普通 API 固定返回 Go 套餐 403、只有 CLI 可用”的服务验证；真实 Go 账号的服务端权限和额度仍需在你的环境确认。

## 认证错误诊断（v0.1.1）

OpenClaw 可能把不同的底层错误统一显示为 "Couldn't sign in"。v0.1.1 在请求失败时，通过宿主 logger 输出一条独立诊断：

```text
[commandcode-go] request_failed {"stage":"http","credentialSource":"runtime","httpStatus":401,"code":"AUTH_REJECTED"}
```

- `credentialSource: runtime`：使用宿主传入的凭据，可能来自已保存的 profile；它本身不证明是哪一个账号或 key 是否正确。
- `stage: credentials`、`code: MISSING_CREDENTIAL`：插件尚未发出请求，未取得可用 key。
- `stage: http`、`httpStatus: 401`：服务端拒绝实际请求的认证；不等于 CLI 中的所有凭据都已失效。
- `httpStatus: 403`：请求被拒绝，需要进一步区分模型权限、套餐或访问策略。识别到的套餐/余额错误有单独 code。
- `stage: stream`：HTTP 已连接，但随后生成流失败。
- 没有这条诊断时，应先确认已加载 v0.1.1 或以上版本，并继续检查宿主在进入 provider 之前的失败。不要仅凭来源 provenance 警告认定认证失败。

日志只包含固定类别、阶段、凭据来源类别及 HTTP 状态，不包含 key、key 指纹、请求内容、完整 URL 或服务端原始错误正文。

```bash
openclaw plugins update commandcode-go
openclaw gateway restart
openclaw plugins inspect commandcode-go
openclaw logs --follow
```

在触发失败后查找 `[commandcode-go] request_failed`。`openclaw models status --agent main` 用于核对该 agent 实际选择的认证来源；CLI 能正常对话并不能单独证明 Gateway 发送了相同凭据或获得了相同路由权限。

## 开发验证

```bash
npm test
npm run typecheck
npm run build
npm run test:host
npm run test:agent
npm pack --dry-run
```

`npm test` 包含临时 loopback HTTP 服务，需要允许绑定本机端口。`test:host` 将所有测试配置、HOME 和状态放在本目录 `.scratch/`。`test:agent` 使用系统临时目录、虚构 key 和本机模型服务验证真实宿主工具执行；冷启动会捕获依赖，可能需要一分钟左右。测试明确关闭 `toolSearch` 和 `codeMode` 来验证直接工具调用；不要求你修改日常工具设置。以上测试不使用你的真实账号或 Gateway 配置。使用符合版本要求的 Node 执行命令。

`npm run test:install` 会在系统临时目录安装已构建的 `.tgz`，需要联网下载运行依赖。安装后的 Doctor 会提示本地包来源尚未验证，脚本只允许这一项已知警告。

`COMMANDCODE_TEST_INSTALLED=1 npm run test:agent`（Bash/zsh）还会在临时 HOME 安装已打包的插件，以实际全局安装来源、已保存 key profile 和残留旧 API 配置验证同一个工具循环；需要先运行 `npm pack`，并允许下载公开运行依赖。

详细验收范围与边界见 `docs/spec.md`，实际验证记录见 `docs/verification.md`。

协议逻辑移植自 [Mars-Sea/dsh-commandcode-provider](https://github.com/Mars-Sea/dsh-commandcode-provider)，保留其 MIT `LICENSE` 与 `NOTICE`。OpenClaw SDK 通过 peer dependency 使用宿主版本，不打包进插件。

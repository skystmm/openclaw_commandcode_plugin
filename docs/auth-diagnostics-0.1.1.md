# v0.1.1 认证诊断

用户报告官方 Command Code CLI 使用同一账号 key 可以对话，但 OpenClaw 显示通用认证失败。状态显示宿主已找到 `commandcode:default` 的 API-key profile；没有收到原始 HTTP 状态，不能认定 key 整体失效，也不能认定来源 provenance 警告是根因。

本次解决的是诊断信息缺失，不声称已修复真实 Go 服务拒绝。

## 实现与验证范围

- 先增加 401/403 与缺失凭据的回归测试，确认原先既无 errorCode，也无独立诊断。
- 传输层保留固定错误类别，并在失败时通过注册入口提供的宿主 logger 输出 stage、credentialSource、HTTP status 和 code。
- 不输出 key、指纹、请求或响应原文、URL；未知上游错误不直接进入日志。诊断回调失败不影响单次流终止。
- HTTP 403 不再一概称作登录失败；根据服务端结构化错误区分已知套餐、额度及认证类别。
- 原本使用环境变量的 native agent 测试增加为保存到真实 SQLite auth store 的 API-key profile 路径，以验证宿主传入的值能正确成为 Authorization header；测试仅使用虚构 key。
- 更新版本到 0.1.1，安装烟雾脚本从 package.json 读取包名与版本，避免测试旧安装包。

实际验证：`npm run check` 通过，包含 19 项测试、类型检查与构建。最终构建的 `node --import tsx --test tests/agent.test.ts` 通过，真实宿主从 SQLite API-key profile 取得虚构 key 并完成工具循环，约 55 秒。`npm pack --ignore-scripts --json --cache .scratch/npm-cache` 通过；版本元数据一致，检查未发现环境中的 GitHub token 被写入源文件或构建产物。

## 仍需远端证据

真实 Go 请求的拒绝原因尚未确定。需要失败请求的安全诊断及 CLI 版本，再判断是 Gateway 选择了不同凭据、服务端权限/策略、CLI 协议变化或其他原因。不能把本机模拟服务的成功归因到真实服务可用性。

Standards：范围限定为诊断和对应回归；无凭据扫描、请求重放、套餐回退或关闭 ZDR。Spec：补足用户当前认证失败的可定位信息，保留原始问题未确认的边界。

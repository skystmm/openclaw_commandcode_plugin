# v0.1 验证记录

日期：2026-10-27。OpenClaw：npm 正式包 `2026.10.7`（CLI 标识 `157d8c2`）。宿主加载与 HTTP 测试使用 Node.js `24.22.1`；初始本机 Node `24.14.0` 不满足该 OpenClaw 版本要求，没有把它当作宿主兼容结论依据。

## 已执行

- test-first：先写文本/思考/工具闭环与错误测试，确认因缺少 transport 模块失败；实现后通过。首轮另捕获并修复套餐错误提示被通用错误覆盖的问题。
- 快速测试（`npm test`）：16 项，覆盖协议、HTTP、配置、注册及首次模型解析。HTTP 测试因沙箱禁止 loopback 监听而申请权限后重跑。
- `node --import tsx --test tests/agent.test.ts`：1 项通过，使用真实 OpenClaw embedded agent + loopback 模拟服务。实际发送两次 CLI 请求，宿主执行 `session_status` 并回传成功结果，最终输出 `GO_AGENT_SMOKE_OK`；同一会话 threadId 保持一致。本次实测耗时约 54 秒。
- `npm run typecheck`：通过，对真实 OpenClaw 2026.10.7 的 `ProviderPlugin`、插件入口及 @openclaw/ai 类型检查。
- `npm run build`：通过，生成独立 ESM 与类型声明。
- `node scripts/host-smoke.mjs`：通过。隔离 HOME、状态和配置，用真实 CLI 检查 `plugins inspect commandcode-go --json`：`status: loaded`、`providerIds: [commandcode]`、无 diagnostics；`plugins doctor` 通过发现、模块加载、兼容性和配置检查。
- `npm pack --dry-run --json --ignore-scripts --cache .scratch/npm-cache`：通过，核对仅包含运行产物、manifest、文档和许可证，不包含凭据、SDK 下载、测试状态或 node_modules。
- `.tgz` 在独立临时目录通过真实 `plugins install` 安装，运行依赖安装成功，OpenClaw peer 由宿主链接。随后 inspect 显示 loaded、provider 注册成功；本地未发布包有预期的 `provenance-invalid` 来源警告，未将其描述为可信发布包。

## 验证中遇到的环境问题

- `plugins validate --root .` 是工具/feature authoring metadata 验证入口，在本 provider-only 包上报告不暴露该元数据；不把它记为通过，改用宿主实际 inspect + doctor 证明 provider 加载。
- 初次 `plugins install --link` 在嵌套下载的参考 SDK 同时存在时报告安装 owner 冲突；后续 Doctor 还从该参考 SDK 错选 bundled extension 路径。将重复参考 SDK 移出项目后，独立 smoke 的 inspect + doctor 均通过。未修改 OpenClaw 源码来规避检查。
- 初次 npm dry-run 被默认缓存目录沙箱权限阻止，后经授权使用项目内缓存重跑通过。
- Agent 回归测试捕获首次目录尚未持久化时的 `Unknown model`：已先增加失败回归测试，再补充仅对已配置 id 生效的 `resolveDynamicModel`，目标测试通过。
- 初始 Agent 测试的 45 秒总时限不足，诊断 timeline 显示宿主多次捕获依赖。将宿主启动预算与推理超时分离后获得完整反馈；没有通过扩大真实模型请求超时掩盖协议错误。
- OpenClaw 2026.10.7 默认使用 `toolSearch` 延迟暴露工具。最初测试直接调用未暴露的 `session_status`，宿主返回 not-found，未把这次结果当作成功执行工具。测试明确选择直接工具模式后，验证工具存在、返回非错误结果，并完成最终回答。

## Standards 轴审查

使用原生 SDK 子路径与声明的精确 peer；运行时 AI 流工具为同版本独立依赖。配置运行校验与 manifest schema 同步测试。生成请求不跟随重定向，诊断只输出受控错误，不附原始服务端正文。无自动扫描凭据、自动 Provider API 回退或流中途重放。原 DSH 源码未变，MIT/NOTICE 保留。类型、构建、行为测试及打包检查均通过。

## Spec 轴审查

以 `docs/spec.md` 为验收基准：完成 key setup、provider 注册、显式模型目录、Go CLI wire、多轮工具闭环、思考回放、用量、取消、期限、错误和可打包产物。首版范围外项在 README 列出；不会声称零费用估算代表真实账单。

## 尚未验证

未使用真实账号 key、未访问付费生成接口、未验证服务端当前 Go 访问权或额度扣减、未跑用户真实 Gateway 的会话。真实宿主工具循环已对本机模拟服务验证；不等于真实 Command Code 服务验证。浏览器授权登录、图片、实时目录、轮换和余额看板不在 v0.1 范围内。真实 Go 联调仍是发布前的重要条件。

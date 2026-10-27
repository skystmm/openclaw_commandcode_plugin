# v0.1.2：Go 专用传输

用户要求把范围收敛为 Go 套餐。此次保留账号凭据和 `commandcode/<model>` 引用，停止把模型描述成普通 OpenAI-compatible API。

## 证据与修复

旧实现虽然提供了自定义 CLI StreamFn，但动态模型与目录仍发布 `api: openai-completions`。独立宿主 runtime 缺少该 StreamFn 时，公共 API 适配器会被选中。回归测试用同一 runtime 模拟公共 API，控制组复现 `403 Your Go plan doesn't include API access.`；新模型在专用传输缺失时终止，不再调用该公共适配器。

- 模型目录和动态模型改用 OpenClaw 2026.10.7 支持的原生 `pi-messages` 槽。
- `normalizeResolvedModel` 把旧模型上的普通 API 类型和 Provider API base URL 归一化为 CLI 传输；已正确的模型不重复改写。
- 普通轮次和直接/辅助补全均显式提供 Go CLI StreamFn。
- 不修改或删除用户的配置、key profile，不对其他 API/套餐做兼容承诺。
- 仍仅发送 `/alpha/generate`；没有遇到 403 后切换账号、套餐或其他计费端点的逻辑。

这证明旧元数据存在回退风险，不证明已拿到远端失败请求的全部证据。用户实际 Go 服务拒绝的原因仍需更新后验证；不能把本机模拟服务当作真实账号验证。

## 验收场景

服务只接受 CLI；其他路径固定返回 Go 套餐 403。OpenClaw 保存一个虚构 API-key profile，同时保留旧的 `models.providers.commandcode`（OpenAI API + `/provider/v1`）。验收要求所有生成请求到 `/alpha/generate`，成功执行宿主工具并回传结果，原工具预算和 key profile 保持有效。还测试从归档实际安装后的全局插件来源，不只测试源目录加载。

实际结果：

- `npm run check`：22 项快速测试、类型检查、构建均通过。覆盖旧 API 配置归一化、原生传输缺失时不回退、辅助补全绕开返回 Go 403 的普通 API 适配器，以及既有取消/错误/凭据测试。
- 源目录宿主 Agent 场景：通过，约 55 秒；保存的 key profile + 残留 `/provider/v1` 配置下，两个生成请求均到 CLI 端点。
- `COMMANDCODE_TEST_INSTALLED=1 node --import tsx --test tests/agent.test.ts`：实际安装归档后的全局插件 + 同一旧配置场景通过，约 77 秒；工具执行成功、结果回传、最终回答及稳定 threadId 均通过断言。
- 首次冷安装因下载依赖超过测试的 90 秒安装时限而未完成；日志显示公开依赖下载，未进入模型请求。安装预算独立调整为 180 秒后重跑通过，单个模型请求与流空闲预算未改变。
- `npm pack --ignore-scripts --json --cache .scratch/npm-cache`：生成 0.1.2 安装包。没有真实账号 key 或付费生成请求参与上述测试。

Standards 轴：使用宿主已有原生 API 类型和公开 hooks，无全局 registry patch；模型归一化幂等；保留既有取消、超时和凭据诊断测试。Spec 轴：范围限定 Go CLI，标准 API 不参与推理；未做其他套餐、图片、登录 UI 或计费扩展。

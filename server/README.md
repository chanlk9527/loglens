# LogLens 轻量后端

Node.js 22+，仅使用内置模块，不需要 npm install 或数据库。当前提供静态页面与单轮证据诊断接口；前端 AI 输入框、本地证据筛选、自动脱敏、多轮工具调用、历史记录尚未接入。

## 启动

在仓库根目录用 PowerShell 执行：

```powershell
.\server\start.ps1
```

打开 http://127.0.0.1:8080 。未配置模型时页面仍可使用；非空证据的诊断请求返回 503，不伪造诊断。Ctrl+C 停止。可通过 `$env:PORT = '8081'` 修改端口。

公司透明加密可能让 Node 读到密文，因此启动器统一用严格 UTF-8 的 PowerShell/.NET ReadAllText 读取源码，失败时回退 rg，再通过标准输入传给 Node。Node 不直接读取本地源码或日志。页面资源启动时载入内存，修改后需要重启。只提供明确列出的前端资源，不暴露日志目录、服务端源码或任意文件。

## 模型配置

在启动服务的 PowerShell 进程中设置环境变量（不要把真实密钥写入仓库）：

```powershell
$env:AI_BASE_URL = 'https://your-provider.example/v1'
$env:AI_MODEL = 'your-model-id'
$env:AI_API_KEY = 'your-key'
.\server\start.ps1
```

AI_BASE_URL 是 API 根地址，服务会追加 `/chat/completions`，不是完整接口 URL。适配 Chat Completions JSON 协议，要求支持 `response_format: {type: 'json_object'}`、`max_completion_tokens` 和 `store: false`；不是所有兼容厂商都支持这些字段，实际接入时需验证。协议参考：[Chat Completions 官方文档](https://developers.openai.com/api/reference/resources/chat)。不自动选择模型或服务商。仅允许 HTTPS，回环地址可用 HTTP 对接本地模型；拒绝上游重定向。

默认只绑定 127.0.0.1，并验证 Host / Origin；这是单机开发服务，尚无用户认证、按用户配额或团队隔离，不能直接改为公网监听用于团队部署。请求和模型响应不写入磁盘，不打印日志内容或密钥；服务商的数据保留策略需按实际配置确认，`store: false` 不等于零保留承诺。

## 接口

`GET /api/health`：返回服务状态、模型是否配置和大小限制，不返回密钥或上游地址。

`POST /api/diagnose`：Content-Type 为 application/json，调用方提交已筛选和脱敏的证据。服务端不接受整份原始日志上传，不会自行自动脱敏；在前端脱敏接入之前请仅使用合成数据或已经检查的片段。

```json
{
  "datasetId": "import-1",
  "question": "添加设备失败，能否定位到发生问题的环节？",
  "coverage": "仅包含 12:00 至 12:05 的客户端日志；设备日志未提供；时间未校准。",
  "evidence": [
    {"id": "E1", "text": "12:01:00 文件-1:42 阶段=scan 结果=fail，操作=操作-1"}
  ]
}
```

证据 id 在数据集内保持稳定，由前端保留 id 到文件行号的映射。text 包含必要时间、阶段、关联强度及脱敏片段；coverage 必须说明范围、截断、未解析文件等限制。datasetId 随响应原样返回，前端应拒绝展示属于旧数据集的结果。

响应包含 datasetId、policyVersion、notice 和 diagnosis。diagnosis 字段：

| 字段 | 含义 |
|---|---|
| status | insufficient_evidence / hypothesis / supported_stage |
| summary | 当前判断与不确定性 |
| observations | 日志观察：text、evidenceIds |
| hypotheses | 候选解释：text、evidenceIds、counterEvidenceIds、missingEvidence |
| limitations | 覆盖和推断限制 |
| nextChecks | 下一步补证或核对动作，不能为空 |

supported_stage 仅表示定位到有证据支持的环节，不表示根因已确定。空证据直接返回 insufficient_evidence，不调用模型、不收费。模型返回不存在的证据编号、缺少必要字段、拒答或被截断时返回错误，不把半成品当诊断。

引用校验只验证引用存在、结构合法，不能证明文字在语义上受证据支持。当前通过系统约束要求事实与假设分离、不把缺失当失败、检查反证、禁止虚构根因；仍需用户核对原文。前端后续应以纯文本渲染模型输出。

## 限制与错误

- 单次请求最多 64 KiB；规范化上下文最多 48 KiB；最多 60 条证据，每条 2000 字符。超限拒绝，不静默截断。
- 当前是字节/字符预算，不是精确 token 计数；需根据模型窗口进一步配置。最大输出预算 3000 tokens（部分模型包含推理开销），不足时返回不完整结果错误。
- 每次诊断只调用模型一次，无自动重试；45 秒超时，最多 2 个并发请求；客户端断连取消上游调用。没有跨请求累计 token 配额。
- 400：输入无效；413：请求/上下文超限；415：非 JSON；429：并发已满；503：模型未配置；502：模型调用或输出校验失败；504：超时。
- 错误响应为 `{"error":{"code":"...","message":"..."}}`，不转发服务商原始错误。

## 验证

```powershell
.\server\start.ps1 -Test
```

使用本地模拟模型服务和合成日志，检查页面资源、访问边界、大小限制、证据引用、模型协议、错误隐藏、超时与并发回收。不使用真实密钥、不发送真实日志。已有前端验证仍使用 `.\web\verify.ps1`。
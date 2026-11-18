# 分析规则维护

规则库面向排查线索，不输出自动根因结论。所有规则和示例仅在本地执行。

## 文件与职责

- `parser.js`：日志头、业务字段、明确操作标识及请求关联。修改格式识别时必须保留原文和文件行号。
- `business-ui.js`：业务名称、阶段中文名、合成演示数据。
- `analysis.js` 的 `diagnosticRules`：规则版本、可能影响和下一步检查建议。业务分类来自解析器，不根据用户身份猜测责任团队。
- `analysis.js`：业务相关记录分组、恢复证据、报告与稳定标识替换。
- `analysis-tests.js`：关键误判边界的回归测试。

## 新规则的最少信息

增加业务或错误码解释之前，请记录：适用 SDK / App 版本、明确匹配字段、字段含义的确认来源、正反例、可能影响、证据不足时的措辞。未经确认的错误码只展示原码，不把英文缩写自动翻译为根因。

例如要支持新的配网失败码，应先让熟悉对应 SDK 的同事确认它发生在哪个阶段、是否可以重试，以及是否可能在操作成功后仍打印。确认之前可以归为候选，但不能输出“网络故障”或“设备损坏”。

## 当前关联规则

| 依据 | 展示语义 | 边界 |
|---|---|---|
| `operationId` / `attemptId` / `provisionId` | 明确操作标识的业务过程 | 同业务、同来源范围；不把阶段成功当成全流程成功 |
| 唯一请求与响应配对 | 配对请求 | 来源范围、requestId 和 API 均相同；重复 ID 或逆序结果保留冲突 |
| 产品设备标识 | 同设备可能相关记录 | 无明确操作标识时才采用；空闲超过 5 分钟拆组，不统计为尝试 |
| 只有时间接近 | 未归属记录 / 时间上下文 | 不自动创建业务会话 |

来源范围默认是文件。记录明确带 `sessionId` 时，允许同目录下相同 sessionId 跨文件关联；不同目录隔离。不应把多个独立用户的日志混放在同一目录并假设相同 sessionId 一定全局唯一。

请求 API 缺失和已知 API 不强行匹配。这个选择会增加未配对记录，但可避免把不同接口关联起来。未配对、未观察到成功、缺少某阶段，都不等于失败。

恢复观察检查当前全局筛选内、末次候选之后 5 分钟内的同业务、同阶段明确成功记录：相同操作 ID 只说明该阶段随后成功；没有操作 ID 时，同设备成功只表示可能相关。其他阶段成功不用于恢复判断。不同设备、不同来源或超出窗口的成功不参与关联。

## 报告与脱敏

默认 Markdown 报告使用字段白名单，包含时间、阶段中文名、结果、规则建议和证据位置；不包含原始消息、文件名、未知业务字段与环境值。设备、请求和文件标识在每份报告内稳定替换；不同报告不保证相同别名。

实际现象和预期行为属于自由文本，对邮箱、常见 token / password 字段、JWT、IP、MAC、手机号以及已知设备标识执行规则脱敏。规则无法保证发现任何自由文本中的秘密，因此界面要求共享前检查。原文 JSON 是独立且明确命名的导出，不执行脱敏。

## 验证

执行 `./build.ps1` 生成独立入口，再执行 `./verify.ps1`。验证器通过严格 UTF-8 PowerShell/.NET 读取源码，失败时使用 rg，随后把源码传入 Node；Node 不直接读取本机源文件。

测试覆盖：脚本初始化、DOM ID、筛选与导出一致性、同名来源隔离、重复请求 ID、跨来源 / API 隔离、显式操作过程、阶段恢复正反例、报告省略与替换、严格解码、ZIP Store / Deflate / CRC / 大小限制，以及构建产物一致性。

浏览器验收建议：体验示例 → 配网场景 → 明确操作标识 → 选择两组过程对比 → 打开证据并切换关联方式 → 填写现象 → 导出 Markdown → 导入 ZIP 和含不支持格式的文件夹。测试应使用合成日志。
## 精简首页的范围约定
默认最多展示 3 类线索，可逐次增加 5 类。排序依据是相似记录数，不是严重程度。默认打开统计概览；异常、日志检索、业务分析和报告通过横向标签切换。全局筛选始终通过首页提示显露，业务表独立筛选不影响首页。
单问题报告包括本类记录与末次候选的关联证据，并明确标注报告范围。测试覆盖默认概览、标签切换、逐次展开、单问题导出隔离、原文入口和筛选恢复。

## 技术类型回退与聚合
issue-model.js 的 technicalRules 只描述文本指向的技术类型，不修改 business.category。规则按证书、DNS、网络超时、一般超时、资源、HTTP、网络、权限、存储、运行时异常顺序匹配；未知时不猜测。issueReasons 展示原始 Error、明确 fail 字段及失败语义命中。
聚合键包含来源、业务、阶段、技术类型、诊断码及多行消息模板；不再忽略任意长数字，也不只看消息第一行，避免错误码和多行原因混并。仅归一化明确标识字段、UUID、时间、内存地址和耗时。

## 2026-11-17 解析与计数修正

异常入选只读 `e.issue`，由 `classifyAnomaly` 统一生成，导入和切换模式走同一函数。业务事实 `outcome=fail` 在等级模式下仍可在业务表看到，但不绕过当前异常规则进入异常分组。切换回等级模式时清除从内容规则推导的 `candidate`；不清除明确记录的 fail / success。

业务识别依据来自本地 22 个文本日志中实际出现的模块、方法和标签，适用范围是当前日志格式，未确认跨 App / SDK 版本语义，不新增错误码或根因解释：

| 分类 | 明确匹配依据 | 反例与边界 |
|---|---|---|
| 觅睿配网 | `MeariProvision*` 模块，或消息开头 `【觅睿】` 且同一行带 `阶段=` | `MeariManager` 的 Registry 同步、只包含“觅睿”的文本不算配网 |
| 蓝牙 | `BTManager`、`BT+`、`BLELiveActivityRecovery`、Thing BLE / OSBLE / ActivatorBle、BM08SBLE、BLEDeviceConnect、`LTDevicesViewModel+BLEScan` 模块；开头 BT 标签 | 仅 payload 提及 BTManager 不改变来源业务；没有明确 BLE 依据的通用发现 / Mesh 模块仍未识别 |
| 吸奶器状态 | PumpActivity / PumpFloating / TPumpLiveActivity、M5ProPumpPresentation、LTPumpM5ProIsland、LegacyPumpIsland、`LTDevicesViewModel+Pump`；开头 PUMP / LegacyPumpIsland 标签 | 不由产品名推断操作成功或设备运行状态 |
| MQTT | Thing MQTT 模块或调用方法（包括 `ThingMessageHandleService mqttChannel`），开头 mqtt 标签 | 请求数据中出现 MQTT 字样不算来源证据 |
| RN / OTA | RNFull / RNOta / RNReach / RNBundle 模块（可带 LT 前缀）或明确开头标签 | payload 中提及模块名不能覆盖当前模块 |
| 登录与验证码 | LoginCodeInput / CodeInputViewModel、VerifyCodeSendSession、AuthSessionEventLogger、NewFlowAuth、EmailOrPhoneInput、MeariAuthGate、IotKitProviderAuthService、AppTokenRenewalManager、PostLoginFlow；setupGeetest / getEmailCode 方法；user.uid.token / password 接口 | SDK 登录归为 sdk_login 阶段，不解释成配网完成；一般路由记录提及页面类名不算登录业务 |

保留分类依据 `business.basis`，详情展示来源模块或明确标签 / 接口。分类不完整时保持空 category，业务表显示“未识别业务”；不为凑足总数推断业务。

有效日志头允许秒或 1–3 位毫秒，并规范为 3 位毫秒以供排序；原文保持不变。未知等级保留 `rawLevel`。无效日期（包括日期自动进位）与格式错误的时间头计入 `invalidHeaders`，它是 `unmatched` 的子集。物理行守恒：所有事件覆盖行数 + 未归属非空行 + 未归属空行 = 文件物理行数。
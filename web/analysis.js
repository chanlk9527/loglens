/* Pure evidence model. No time-only association is described as an actual attempt. */
const diagnosticRules = {
 version:'2026-11-18.1',
 provision:{label:'配网',impact:'可能影响设备添加或配网推进',next:'核对失败阶段、SDK 登录结果、扫描结果与后续重试；必要时补充设备侧日志。'},
 bluetooth:{label:'蓝牙',impact:'可能影响手机与设备之间的连接',next:'核对蓝牙状态、主动断开操作、前后台变化，以及同设备后续连接记录。'},
 mqtt:{label:'MQTT',impact:'可能影响设备消息订阅或状态同步',next:'核对连接、订阅回执与后续重连；连接成功不能证明订阅或消息送达成功。'},
 pump:{label:'吸奶器状态',impact:'可能影响 App 中的状态展示',next:'核对设备标识与状态快照；浮窗状态不能证明设备实际运行或停止。'},
 rn:{label:'页面 / 资源加载',impact:'可能影响页面或资源加载',next:'核对资源版本、加载完成与资源注册结果；策略跳过不等于加载失败。'},
  auth:{label:'登录 / 验证码',impact:'可能影响验证码获取或登录',next:'核对对应接口的响应和重试结果，并使用请求标识查找服务端记录。'},
  stream:{label:'推拉流',impact:'可能影响设备实时音视频预览或会话连接',next:'按设备与会话标识串联拉流、停流、DataChannel、ICE 和连接错误记录，确认是否存在后续成功阶段。'},
 other:{label:'未分类',impact:'实际影响尚不明确',next:'结合问题时间、请求响应和前后操作确认；错误级别本身不能说明根因。'}
};
function diagnosticFor(e){if(diagnosticRules[e.business?.category])return diagnosticRules[e.business.category];const hint=technicalHint(e);return {label:hint.label,impact:'尚未识别业务归属；技术类型仅来自文本特征，不代表根因',next:hint.next};}
function evidenceScope(e){return e.sessionId ? `${e.file.includes('/')?e.file.slice(0,e.file.lastIndexOf('/')):''}|session:${e.sessionId}` : e.file;}
function buildProcesses(items){
 const buckets=new Map(), result=[];
 for(const e of items){
  const b=e.business||{};if(!b.category)continue;
  let key,confidence;
  if(e.operationId){key=JSON.stringify([evidenceScope(e),b.category,'operation',e.operationId]);confidence='explicit';}
  else if(e.partner!==undefined){key=JSON.stringify([b.category,'request',Math.min(e.id,e.partner)]);confidence='request';}
  else if(b.device){key=JSON.stringify([evidenceScope(e),b.category,'device',b.device]);confidence='device';}
  else {key=`unassigned:${e.id}`;confidence='unassigned';}
  let group=buckets.get(key);
  // Split only probable device timelines, never infer a session from proximity alone.
  if(group&&confidence==='device'&&e.stamp-group.items.at(-1).stamp>300000)group=null;
  if(!group){group={id:result.length,category:b.category,confidence,items:[]};result.push(group);buckets.set(key,group);}
  group.items.push(e);
 }
 for(const group of result){
  const first=group.items[0],last=group.items.at(-1);
  group.elapsed=last.stamp-first.stamp;
  group.hasFailure=group.items.some(e=>e.issue||e.business.outcome==='fail');
  group.hasSuccess=group.items.some(e=>e.business.outcome==='success');
  group.result=group.hasFailure?'含异常证据':group.hasSuccess?'含阶段成功记录':'结果未明确';
 }
 return result;
}
function recoveryEvidence(issue,items){
 const b=issue.business||{};
 const insufficient=recoveryEligibility(issue);if(insufficient)return {status:'unknown',text:insufficient};
 const later=items.find(e=>e.stamp>issue.stamp&&e.stamp-issue.stamp<=300000&&
  evidenceScope(e)===evidenceScope(issue)&&e.business?.category===b.category&&e.business.stage===b.stage&&
  e.business.outcome==='success'&&!e.issue&&
  ((issue.operationId&&e.operationId===issue.operationId)||(!issue.operationId&&b.device&&e.business.device===b.device)));
 if(!later)return {status:'unknown',text:'当前可见范围内，未找到可关联的同阶段后续成功证据；不能认定持续失败。'};
 return {status:issue.operationId?'stage_success':'possible',event:later,
  text:issue.operationId?'相同操作标识、相同阶段随后记录成功；仅证明该阶段出现成功，不代表整个业务恢复。':'同设备、同阶段在 5 分钟内出现成功；可能是另一次尝试，不能确认本次恢复。'};
}
function requestSummary(items){
 const requests=items.filter(e=>e.direction==='request');
 const paired=requests.filter(e=>e.partner!==undefined), durations=paired.map(e=>e.duration).sort((a,b)=>a-b);
 return {paired:paired.length,unmatched:items.filter(e=>e.direction&&e.pairStatus==='unmatched').length,
  ambiguous:items.filter(e=>e.pairStatus==='ambiguous').length,
  p95:durations.length?durations[Math.ceil(durations.length*.95)-1]:null};
}
function createRedactor(items){
 const aliases=new Map(),counts=new Map();
 const alias=(kind,value)=>{const key=kind+'|'+value;if(!aliases.has(key)){const n=(counts.get(kind)||0)+1;counts.set(kind,n);aliases.set(key,`${kind}-${n}`);}return aliases.get(key);};
 const known=new Map();
 for(const e of items){for(const [kind,value]of [['设备',e.business?.device],['请求',e.requestId],['操作',e.operationId],['会话',e.sessionId]])if(value)known.set(value,alias(kind,value));}
 const tokens=[...known].sort((a,b)=>b[0].length-a[0].length);
 const text=value=>{
  let s=String(value||'');
  s=s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,v=>alias('邮箱',v));
  s=s.replace(/\b(?:Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,()=> '[令牌已隐藏]');
  s=s.replace(/((?:["']?)(?:password|passwd|token|access_token|refresh_token|authorization|secret|apiKey|email|phone|mobile|uid|userId|deviceId|devId|device_id|requestId|sessionId|operationId|attemptId|address|latitude|longitude|验证码)(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,(_,prefix)=>prefix+'[已隐藏]');
  s=s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,v=>alias('IP',v)).replace(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi,v=>alias('MAC',v));
  s=s.replace(/\b1[3-9]\d{9}\b/g,v=>alias('电话',v)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[令牌已隐藏]');
  for(const [original,replacement]of tokens)if(original.length>=4)s=s.split(original).join(replacement);
  return s;
 };
 return {alias,text};
}
function buildReadableReport(items,reports,actual,expected){
 const redact=createRedactor(items), refs=new Map(items.map((e,i)=>[e.id,`E${i+1}`]));
 const lines=['# LogLens 排查报告',`规则版本：${diagnosticRules.version}`,'范围：当前全局筛选。所有时间均为日志原始时间，未做时区转换。',
  `导入条目 ${reports.length} 个；当前 ${items.length} 条事件。业务条目和异常记录数不代表操作次数。`,
  '',`实际现象：${redact.text(actual)||'待补充'}`,`预期行为：${redact.text(expected)||'待补充'}`,
  '', '## 文件覆盖'];
 for(const r of reports)lines.push(`${redact.alias('文件',r.name)}：${r.state||'见导入明细'}；事件 ${r.count??'未知'}；未归属行 ${r.unmatched??'未知'}${r.start?'；'+r.start+' 至 '+r.end:''}`);
 lines.push('','## 请求关联',JSON.stringify(requestSummary(items)),'未配对不等于失败；冲突请求不自动配对。','', '## 异常与建议');
 for(const g of groupIssues(items)){
  const first=g.items[0],last=g.items.at(-1),rule=diagnosticFor(first),recovery=recoveryEvidence(last,items);
  lines.push(`- ${rule.label}：${g.items.length} 条疑似异常日志；${first.time} 至 ${last.time}。`,
   `  入选依据：${issueReasons(first).join('；')}。${rule.impact}。${rule.next}`,`  ${recovery.text}`,`  证据：${g.items.map(e=>refs.get(e.id)).join('、')}${recovery.event?'；后续成功 '+refs.get(recovery.event.id):''}`);
 }
 lines.push('','## 业务过程 / 相关记录');
 for(const p of buildProcesses(items)){
  lines.push(`- ${diagnosticRules[p.category]?.label||'业务'}：${p.result}；${p.confidence==='explicit'?'明确操作标识':p.confidence==='request'?'已配对请求':p.confidence==='device'?'同设备可能相关':'未归属单条记录'}；记录跨度 ${p.elapsed} ms。`,
   p.items.map(e=>`${refs.get(e.id)} ${stageNames[e.business.stage]||'其他阶段'} (${outcomeNames[e.business.outcome]||'未标记'})`).join(' → '));
 }
 lines.push('','## 证据索引');
 for(const e of items)lines.push(`${refs.get(e.id)} | ${e.time} | ${redact.alias('文件',e.file)}:${e.line}-${e.endLine} | ${diagnosticFor(e).label} | ${stageNames[e.business?.stage]||'其他阶段'} | ${outcomeNames[e.business?.outcome]||'未标记'}${e.business?.device?' | '+redact.alias('设备',e.business.device):''}${e.requestId?' | '+redact.alias('请求',e.requestId):''}`);
 lines.push('','原始消息、文件名、未知业务字段及环境值默认省略；标识在本报告内稳定替换。填写的现象描述已做常见字段脱敏，共享前仍请检查自由文本。报告不提供根因或完整恢复结论。');
 return lines.join('\n');
}
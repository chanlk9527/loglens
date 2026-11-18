// Technical hints describe observed text, not a business identity or root cause.
const technicalRules=[
 {id:'tls',label:'证书 / TLS',pattern:/\b(?:SSL|TLS|certificate)\b|证书/i,next:'核对证书、TLS 错误原文与请求目标；不要据此直接判断服务端故障。'},
 {id:'dns',label:'域名解析',pattern:/\bDNS\b|cannot find host|unknown host|name resolution|域名解析/i,next:'核对目标域名与当时网络环境，并对照后续请求是否成功。'},
 {id:'network-timeout',label:'网络请求超时',pattern:/(?:request|URLSession|socket|connect|network|HTTP|请求|连接|网络)[\s\S]{0,180}(?:timed out|timeout|超时)|(?:timed out|timeout|超时)[\s\S]{0,180}(?:request|URLSession|socket|connect|network|HTTP|请求|连接|网络)/i,next:'核对请求目标、客户端超时和后续重试；客户端超时不代表服务端一定没有执行。'},
 {id:'timeout',label:'超时记录',pattern:/timed out|\btimeout\b|超时/i,next:'先确认是请求、扫描、计时器还是其他操作超时；超时本身不能说明网络故障。'},
 {id:'resource',label:'资源加载',pattern:/(?:asset|bundle|resource|image|资源|图片)[\s\S]{0,120}(?:failed|failure|not found|missing|失败|不存在)|(?:failed|failure|失败)[\s\S]{0,120}(?:asset|bundle|resource|image|资源|图片)/i,next:'核对资源名称、版本、路径与后续加载记录，确认是否影响页面展示。'},
 {id:'http',label:'接口 / HTTP',pattern:/\bHTTP\b|statusCode\s*[:=]\s*[45]\d\d|\bresponse:|\brequest:|接口/i,next:'核对接口名称、状态码、业务错误码与配对响应；有请求标识时可对照服务端日志。'},
 {id:'network',label:'网络连接',pattern:/\b(?:URLSession|socket|network|connection refused|connection reset)\b|网络|连接被拒绝|连接重置/i,next:'核对当时网络、连接目标和重试结果，并区分主动断开与异常断开。'},
 {id:'permission',label:'权限 / 访问限制',pattern:/permission denied|not authorized|access denied|权限不足|无权限|拒绝访问/i,next:'核对系统权限、登录状态和接口返回，先确认拒绝访问发生在哪一层。'},
 {id:'storage',label:'文件 / 存储',pattern:/\b(?:SQLite|database|disk full|no such file|file not found)\b|磁盘|数据库|文件不存在|存储空间/i,next:'核对文件路径、存储空间或数据库操作；检查是否存在重试或降级记录。'},
 {id:'runtime',label:'运行时异常',pattern:/\b(?:exception|fatal|stacktrace|NullPointerException|TypeError|ReferenceError)\b|异常堆栈/i,next:'查看异常类型与堆栈。仅凭异常文本不能认定发生了 App 崩溃。'}
];
function technicalHint(e){
 const text=(e.location||'')+' '+(e.message||'');
 const rule=technicalRules.find(r=>r.pattern.test(text));
 return rule?{...rule,matched:rule.pattern.exec(text)?.[0].slice(0,100)}:{id:'unknown',label:'类型待识别',matched:'',next:'先查看来源模块和原文，确认这条记录描述的操作；目前没有匹配到业务或技术类型规则。'};
}
function sourceLabel(e){return e.module&&e.module!=='SDK'?e.module:(e.location||'来源未识别').slice(0,100);}
function issueReasons(e){
 const reasons=[];
 if(e.level==='E')reasons.push('原始等级为 E（错误）');
 if(e.business?.outcome==='fail')reasons.push('业务结果标记 fail');
 const match=(e.message||'').match(/\bfailed\b|\bfailure\b|\berror\s*:|结果\s*=\s*fail|失败|请求超时|连接超时|timed out/i);
 if(match)reasons.push(`消息包含“${match[0]}”`);
 return reasons.length?reasons:['异常规则命中，需结合原文确认'];
}
function issueExcerpt(e){
 const lines=(e.message||'').split('\n').map(s=>s.trim()).filter(Boolean);
 const line=lines.find(s=>/failed|failure|error|exception|失败|超时|timed out/i.test(s))||lines[0]||'消息为空';
 return line.length>180?line.slice(0,180)+'…':line;
}
function issueSignature(e){
 // Normalize known variable fields, not arbitrary numbers: status/error codes remain distinct.
 return (e.message||'').split('\n').map(s=>s.trim()).filter(Boolean).join(' ')
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'<UUID>')
  .replace(/\b0x[0-9a-f]{6,}\b/gi,'<地址>')
  .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g,'<时间>')
  .replace(/((?:["']?)(?:requestId|traceId|sessionId|operationId|attemptId|deviceId|device_id|devId)(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,'$1<ID>')
  .replace(/((?:elapsedMs|elapsed|duration|latency|timestamp|totalTime|sslTime|ackTime)\s*[:=]\s*)\d+(?:\.\d+)?/gi,'$1<数值>')
  .replace(/\b\d+(?:\.\d+)?\s*ms\b/gi,'<耗时>')
  .replace(/\s+/g,' ').trim();
}
function recoveryEligibility(e){
 if(!e.business?.category||!e.business?.stage)return '尚未识别业务阶段，不判断恢复情况。';
 if(!e.operationId&&!e.business?.device)return '缺少操作或设备关联标识，不判断恢复情况。';
 return '';
}
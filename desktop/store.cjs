'use strict';
const {randomUUID} = require('node:crypto');
function createStore(input) {
  if (!input || !Array.isArray(input.events) || input.events.length > 250000 || !Array.isArray(input.reports) || input.reports.length > 5000) throw Error('日志数据集格式或数量无效');
  if (Buffer.byteLength(JSON.stringify(input)) > 150 * 1024 * 1024) throw Error('数据集超过 150 MiB，请分批导入');
  const aliases = new Map(), counts = new Map();
  const alias = (kind, value) => {
    if (!value) return '';
    const key = kind + ':' + value;
    if (!aliases.has(key)) { const n = (counts.get(kind) || 0) + 1; counts.set(kind, n); aliases.set(key, kind + '-' + n); }
    return aliases.get(key);
  };
  const str = (value, max = 150 * 1024 * 1024) => typeof value === 'string' ? value.slice(0, max) : '';
  const seen = new Set();
  const entries = input.events.map(e => {
    if (!Number.isSafeInteger(e.id) || e.id < 0 || seen.has(e.id) || !Number.isFinite(e.stamp)) throw Error('事件编号或时间无效');
    seen.add(e.id);
    return {id: e.id, stamp: e.stamp, time: str(e.time, 80), file: str(e.file, 2000), line: e.line, endLine: e.endLine,
      message: str(e.message), module: str(e.module, 200), level: str(e.level, 20), category: str(e.business?.category, 100), stage: str(e.business?.stage, 100), outcome: str(e.business?.outcome, 100),
      device: str(e.business?.device, 500), operation: str(e.operationId, 500), session: str(e.sessionId, 500), request: str(e.requestId, 500),
      partner: Number.isSafeInteger(e.partner) ? e.partner : null, pairBasis: str(e.pairBasis, 100)};
  }).sort((a,b) => a.stamp - b.stamp || a.id - b.id);
  const known = new Map();
  for (const e of entries) for (const [kind, value] of [['文件',e.file],['设备',e.device],['操作',e.operation],['会话',e.session],['请求',e.request]]) if (value) known.set(value, alias(kind,value));
  // Replace identifiers in a single pass; bounded regex batches avoid quadratic per-token scans.
  const tokens = [...known.keys()].filter(x => x.length >= 4).sort((a,b) => b.length-a.length);
  const patterns = [];
  for (let i = 0; i < tokens.length; i += 500) patterns.push(new RegExp(tokens.slice(i,i+500).map(x => x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'), 'g'));
  const redact = value => {
    let s = str(value);
    for (const pattern of patterns) s = s.replace(pattern, x => known.get(x));
    return s.replace(/\bBearer\s+\S+/gi,'Bearer [已隐藏]')
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g,'[令牌已隐藏]')
      .replace(/((?:["']?)(?:password|passwd|token|access_token|refresh_token|authorization|secret|apiKey|phone|mobile|uid|userId|email|address|latitude|longitude|验证码)(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,'$1[已隐藏]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,x=>alias('邮箱',x))
      .replace(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi,x=>alias('MAC',x))
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,x=>alias('IP',x))
      .replace(/\b1[3-9]\d{9}\b/g,x=>alias('电话',x));
  };
  const byId = new Map(entries.map(e => ['E'+e.id,e]));
  const scope = e => e.session ? e.file.replace(/[^/\\]*$/,'') + '|session:' + e.session : e.file;
  function evidence(e) {
    const message = redact(e.message);
    return {id:'E'+e.id, text: `${e.time} (${e.stamp}) ${alias('文件',e.file)}:${e.line}-${e.endLine} ${e.level} ${redact(e.module)} 业务=${e.category||'未识别'} 阶段=${e.stage||'未知'} 结果=${e.outcome||'未知'} 设备=${alias('设备',e.device)} 操作=${alias('操作',e.operation)} 请求=${alias('请求',e.request)}\n${message.slice(0,1100)}${message.length>1100?'\n[消息截断，可用 read 读取后续片段]':''}`};
  }
  const reports = input.reports.map(r=>({file:alias('文件',str(r.name,2000)), status:redact(str(r.status,1000)), unmatched:Number(r.unmatched)||0}));
  function overview() {
    const categories = Object.create(null);
    for (const e of entries) categories[e.category||'未识别']=(categories[e.category||'未识别']||0)+1;
    return {count:entries.length, start:entries[0]?.time, end:entries.at(-1)?.time, categories, files:reports.slice(0,20).map(r=>({...r,status:r.status.slice(0,300),statusTruncated:r.status.length>300})), omittedFiles:Math.max(0,reports.length-20),
      limitation:'只调查本次导入中成功解析的事件；不受界面等级筛选影响。时间是日志原始时间，未校准时区。未解析文件及未归属行不能用于判断。无记录不证明未发生。'};
  }
  function query(name, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('工具参数必须为对象');
    if(Buffer.byteLength(JSON.stringify(args))>4096)throw Error('工具参数最多4 KiB');
    if (name === 'overview') { const offset=args.offset??0;if(!Number.isInteger(offset)||offset<0||offset>5000)throw Error('offset 无效');return {overview:{...overview(),files:reports.slice(offset,offset+20).map(r=>({...r,status:r.status.slice(0,300),statusTruncated:r.status.length>300}))},total:reports.length,offset,truncated:offset+20<reports.length,nextOffset:offset+20<reports.length?offset+20:null,evidence:[]}; }
    if (!['search','context','related','read','aggregate','compare'].includes(name)) throw Error('未知工具');
    const offset=args.offset??0,limit=args.limit??8;
    if(!Number.isInteger(offset)||offset<0||offset>150*1024*1024)throw Error('offset 无效');
    if(!Number.isInteger(limit)||limit<1||limit>20)throw Error('limit 须为1至20');
    const page=(matches,basis)=>({basis,total:matches.length,offset,truncated:offset+limit<matches.length,nextOffset:offset+limit<matches.length?offset+limit:null,evidence:matches.slice(offset,offset+limit).map(evidence)});
    const words=key=>{const values=args[key]??[];if(!Array.isArray(values)||values.length>12||!values.every(x=>typeof x==='string'&&x.length>0&&x.length<=200))throw Error(key+' 须为最多12个字面词');return values.map(x=>x.toLowerCase());};
    const filter=()=>{
      for(const key of ['query','category','module','level','outcome','device'])if(args[key]!==undefined&&(typeof args[key]!=='string'||args[key].length>200))throw Error(key+' 字段无效');
      if((args.start!==undefined&&!Number.isFinite(args.start))||(args.end!==undefined&&!Number.isFinite(args.end))||(args.start!==undefined&&args.end!==undefined&&args.start>args.end))throw Error('时间范围无效');
      if(args.order!==undefined&&!['asc','desc'].includes(args.order))throw Error('order 须为 asc 或 desc');
      const any=words('any'),all=words('all'),exclude=words('exclude'),q=(args.query||'').toLowerCase();
      const matches=entries.filter(e=>{
        if(['category','module','level','outcome'].some(k=>args[k]&&e[k]!==args[k]))return false;
        if(args.device&&alias('设备',e.device)!==args.device)return false;
        if(args.start!==undefined&&e.stamp<args.start||args.end!==undefined&&e.stamp>args.end)return false;
        if(!q&&!any.length&&!all.length&&!exclude.length)return true;
        const s=redact(e.module+' '+e.message+' '+e.device+' '+e.operation+' '+e.request).toLowerCase();
        return (!q||s.includes(q))&&(!any.length||any.some(x=>s.includes(x)))&&all.every(x=>s.includes(x))&&!exclude.some(x=>s.includes(x));
      });
      return args.order==='desc'?matches.reverse():matches;
    };
    const get=id=>{const e=byId.get(id);if(!e)throw Error('证据编号不存在');return e;};
    const related=(e,mode)=>{
      if(!['request','operation','device','context'].includes(mode))throw Error('关联方式无效');
      return entries.filter(x=>x.id===e.id||(mode==='request'?x.id===e.partner:mode==='context'?x.file===e.file&&Math.abs(x.stamp-e.stamp)<=300000:scope(x)===scope(e)&&x.category===e.category&&(mode==='operation'?e.operation&&x.operation===e.operation:e.device&&x.device===e.device&&Math.abs(x.stamp-e.stamp)<=300000)));
    };
    if(name==='search')return page(filter(),'文本或字段匹配，不证明因果');
    if(name==='aggregate'){
      if(!['module','category','outcome','template'].includes(args.groupBy))throw Error('groupBy 无效');
      const matches=filter(),groups=new Map();
      for(const e of matches){
        const key=args.groupBy==='template'?redact(e.message).replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+/g,'<时间>').replace(/\b(?:设备|操作|请求|会话)-\d+\b/g,'<标识>').slice(0,1000):redact(e[args.groupBy]||'未识别');
        if(!groups.has(key))groups.set(key,{key,count:0,first:e.time,last:e.time,sampleId:'E'+e.id});const g=groups.get(key);g.count++;g.last=e.time;
      }
      const sorted=[...groups.values()].sort((a,b)=>b.count-a.count),selected=sorted.slice(offset,offset+limit);
      return {basis:'按记录数量聚合，不代表故障或操作次数。template 仅比较前1000字符的归一化文本，长消息可能合并；需读取原文确认。',matchedEvents:matches.length,total:sorted.length,offset,truncated:offset+limit<sorted.length,nextOffset:offset+limit<sorted.length?offset+limit:null,groups:selected,evidence:selected.map(g=>evidence(get(g.sampleId)))};
    }
    if(name==='compare'){
      if(!['operation','device','context'].includes(args.mode))throw Error('compare mode 无效');
      const left=page(related(get(args.leftId),args.mode),'左侧过程'),right=page(related(get(args.rightId),args.mode),'右侧过程');
      return {basis:'并列证据，不自动推断差异原因。同设备或时间上下文可能涉及不同尝试。',left:{...left,evidence:left.evidence.map(e=>({id:e.id}))},right:{...right,evidence:right.evidence.map(e=>({id:e.id}))},truncated:left.truncated||right.truncated,evidence:[...new Map([...left.evidence,...right.evidence].map(e=>[e.id,e])).values()]};
    }
    const e=get(args.id);
    if(name==='read'){
      const message=redact(e.message);
      return {basis:'单条原文片段，offset 是消息字符偏移',total:message.length,offset,truncated:offset+1100<message.length,nextOffset:offset+1100<message.length?offset+1100:null,evidence:[{id:args.id,text:evidence(e).text.split('\n')[0]+'\n'+message.slice(offset,offset+1100)}]};
    }
    if(name==='context'){
      const radius=args.radiusMs??300000;if(!Number.isInteger(radius)||radius<0||radius>3600000)throw Error('radiusMs 须在0至3600000内');
      return page(entries.filter(x=>x.file===e.file&&Math.abs(x.stamp-e.stamp)<=radius),'同文件时间上下文，不证明同次操作');
    }
    const basis=args.mode==='request'?'解析器配对依据：'+(e.pairBasis||'未知'):args.mode==='operation'?'同来源、业务及明确操作标识':'同来源、业务、设备且前后5分钟，可能是另一次尝试';
    if(args.mode==='context')throw Error('related 请使用 request、operation 或 device');
    return page(related(e,args.mode),basis);
  }

  return {id:randomUUID(), count:entries.length, overview, query, redact};
}
module.exports = {createStore};

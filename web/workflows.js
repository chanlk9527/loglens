let workflowPage=0, workflowItems=[], comparison=[];
const confidenceNames={explicit:'明确操作标识',request:'已配对请求',device:'同设备 · 可能相关',unassigned:'未归属 · 单条记录'};
function evidenceButton(e){const button=document.createElement('button');levelText(button,e,`${e.time} · ${stageNames[e.business?.stage]||e.module} · ${outcomeNames[e.business?.outcome]||'未标记'}`);button.onclick=()=>openDetail(e.id);return button;}
function renderWorkflows(){
 const all=buildProcesses(filtered),type=$('processType').value;
 workflowItems=all.filter(p=>!type||p.confidence===type);
 const pages=Math.ceil(workflowItems.length/12);workflowPage=Math.max(0,Math.min(workflowPage,pages-1));
 $('processCount').textContent=`${workflowItems.length} 组相关记录；${all.filter(p=>p.confidence==='unassigned').length} 条缺少关联标识。不是业务尝试次数。`;
 const list=$('processList');list.replaceChildren();
 for(const p of workflowItems.slice(workflowPage*12,workflowPage*12+12)){
  const card=document.createElement('article'),heading=document.createElement('h3'),description=document.createElement('p');
  heading.textContent=`${businessNames[p.category]} · ${p.result}`;
  description.textContent=`${confidenceNames[p.confidence]} | ${p.items[0].time} 至 ${p.items.at(-1).time} | 记录跨度 ${p.elapsed} ms`;
  card.append(heading,description);
  const stages=document.createElement('p');stages.textContent=p.items.slice(0,12).map(e=>`${stageNames[e.business.stage]||e.business.stage} (${outcomeNames[e.business.outcome]||'未标记'})`).join(' → ')+(p.items.length>12?' …':'');card.append(stages);
  const compare=document.createElement('button');compare.textContent=comparison.includes(p.items[0].id)?'已选为对比项':'加入过程对比';compare.onclick=()=>{const id=p.items[0].id;if(comparison.includes(id))comparison=comparison.filter(x=>x!==id);else comparison=[...comparison.slice(-1),id];renderWorkflows();};card.append(compare);
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`证据 ${p.items.length} 条（展示前 100 条）`;details.append(summary);for(const e of p.items.slice(0,100))details.append(evidenceButton(e));card.append(details);list.append(card);
 }
 if(!workflowItems.length)list.textContent='当前范围没有匹配的业务记录。';
 $('processPage').textContent=`${pages?workflowPage+1:0} / ${pages}`;$('processPrev').disabled=workflowPage===0;$('processNext').disabled=workflowPage>=pages-1;
 const selected=comparison.map(id=>all.find(p=>p.items[0].id===id)).filter(Boolean);
 const panel=$('comparison');panel.replaceChildren();
 if(selected.length!==2){panel.textContent='选择两组记录，对照阶段、结果与记录跨度。可选择成功记录与异常记录进行比较。';return;}
 const note=document.createElement('p');note.textContent=selected[0].category===selected[1].category?'对比只呈现观察到的差异，缺失阶段不代表未执行。':'两组属于不同业务，不能据此比较成功率或归因。';panel.append(note);
 const columns=document.createElement('div');columns.className='comparisonColumns';
 for(const p of selected){const column=document.createElement('div'),title=document.createElement('h3');title.textContent=`${businessNames[p.category]} · ${p.result} · ${p.elapsed} ms`;column.append(title);for(const e of p.items.slice(0,100))column.append(evidenceButton(e));columns.append(column);}panel.append(columns);
}
function renderDiagnosis(){
 renderInsights();renderWorkflows();renderRequestDashboard();
 const stats=requestSummary(filtered);
 $('requestQuality').textContent=`当前范围：${stats.paired} 个已配对请求；${stats.unmatched} 条未配对记录；${stats.ambiguous} 条冲突记录；客户端日志间隔 P95 ${stats.p95===null?'—':stats.p95+' ms'}。未配对不代表失败。`;
 const env=$('summaryEnvironment');env.replaceChildren();const fields=new Map();
 for(const e of filtered)for(const [key,value]of Object.entries(e.environment||{})){if(!fields.has(key))fields.set(key,new Set());fields.get(key).add(value);}
 for(const [key,values]of fields){const span=document.createElement('span');span.textContent=key+' '+[...values].join(' / ');env.append(span);}
 if(!fields.size)env.textContent='当前范围没有明确的版本或系统字段。';
}
$('processType').onchange=()=>{workflowPage=0;renderWorkflows();};
$('processPrev').onclick=()=>{workflowPage--;renderWorkflows();};$('processNext').onclick=()=>{workflowPage++;renderWorkflows();};
$('scene').onchange=()=>{page=0;workflowPage=0;comparison=[];applyFilters();};
$('exportReport').onclick=()=>downloadAnalysis('loglens-report.md',buildReadableReport(filtered,importReports,$('actualBehavior').value,$('expectedBehavior').value),'text/markdown;charset=utf-8');
let detailEventId=null, contextCurrentRow=null;
function centerContext(){
 const box=$('context');
 if(!contextCurrentRow||!$('detail').open)return;
 box.scrollTop=Math.max(0,contextCurrentRow.offsetTop-(box.clientHeight-Math.min(box.clientHeight,contextCurrentRow.offsetHeight))/2);
}
function renderEvidenceContext(){
 const e=events[detailEventId];if(!e)return;
 const mode=$('contextMode').value||'file',radius=Number($('contextRadius').value||5)*60000;
 $('contextRadius').hidden=mode==='file'||mode==='request';
 const near=events.filter(x=>Math.abs(x.stamp-e.stamp)<=radius);
 let relevant, nearest;
 if(mode==='file'){
  const siblings=events.filter(x=>x.file===e.file).sort((a,b)=>a.line-b.line||a.id-b.id),idx=siblings.findIndex(x=>x.id===e.id);
  relevant=siblings;nearest=siblings.slice(Math.max(0,idx-50),idx+51);
 }else{
  relevant=(mode==='request'?events:near).filter(x=>mode==='time'||(mode==='device'&&e.business?.device&&x.business?.device===e.business.device)||(mode==='operation'&&e.operationId&&x.operationId===e.operationId&&evidenceScope(x)===evidenceScope(e))||(mode==='request'&&(x.id===e.id||x.id===e.partner)));
  nearest=relevant.filter(x=>x.id!==e.id).sort((a,b)=>Math.abs(a.stamp-e.stamp)-Math.abs(b.stamp-e.stamp)).slice(0,100);
  nearest.push(e);nearest.sort((a,b)=>a.stamp-b.stamp||a.id-b.id);
 }
 $('context').replaceChildren();$('contextNotice').textContent=mode==='file'?`以第 ${e.line} 行为中心，展示前后各最多 50 条日志（共 ${nearest.length} 条）。按文件行序阅读，点击不会切换当前日志。`:`展示当前日志及附近匹配记录，共 ${nearest.length} 条；时间邻近不代表同一次操作。未匹配关联条件时仍保留当前日志。`;
 contextCurrentRow=null;
 for(const n of nearest){
  const row=document.createElement('div');
  row.className='contextRow'+(n.id===e.id?' currentContext':'');
  row.dataset.id=n.id;
  const body=(n.raw??n.message).replace(/^\[\d{4}-\d{2}-\d{2} [^\]\r\n]+\][ \t]*\[[^\]\r\n]*\][ \t]*/, '');
  levelText(row,n,(n.id===e.id?'【当前日志】 ':'')+`${n.time} · ${mode==='file'?'第 '+n.line+' 行':n.file+':'+n.line}\n${body}`);
  $('context').append(row);
  if(n.id===e.id){contextCurrentRow=row;row.setAttribute('aria-current','true');}
 }
 centerContext();
}
openDetail=function(id){const e=events[id];if(!e)return;const dialog=$('detail');detailEventId=id;$('contextMode').value='file';$('detailLevel').replaceChildren(logLevelBadge(e.level));showBusinessFields(e);$('source').textContent=`${e.time} · ${e.file} · 第 ${e.line}–${e.endLine} 行 · ${e.location}`;$('source').title=$('source').textContent;$('raw').textContent=e.raw;$('reason').textContent=[e.reason,e.pairStatus==='ambiguous'?'请求关联存在冲突，未自动配对。':e.pairStatus==='unmatched'?'未找到唯一配对记录；不代表请求失败。':''].filter(Boolean).join(' ');renderEvidenceContext();if(!dialog.open)dialog.showModal();dialog.scrollTop=0;centerContext();};
$('contextLocate').onclick=centerContext;
$('contextMode').onchange=renderEvidenceContext;$('contextRadius').onchange=renderEvidenceContext;
renderDiagnosis();
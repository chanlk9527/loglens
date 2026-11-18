// Evidence-based summaries: counts are records, never inferred business attempts.
let importReports = [];
function groupIssues(items) {
 const groups = new Map();
 for (const e of items) {
  if (!e.issue) continue;
  const b=e.business||{}, code=b.fields?.['诊断码']||b.fields?.['错误码'];
  const signature=issueSignature(e);
  const key=JSON.stringify([sourceLabel(e),b.category,b.stage,technicalHint(e).id,code||'',signature]);
  if(!groups.has(key))groups.set(key,{title:code||signature,items:[]});
  groups.get(key).items.push(e);
 }
 return [...groups.values()].sort((a,b)=>b.items.length-a.items.length);
}
function currentBusinessEvents(){
 const outcome=$('businessOutcome').value,device=$('businessDevice').value.toLowerCase();
 return filtered.filter(e=>e.business?.category===businessCategory&&(!outcome||e.business.outcome===outcome)&&(!device||e.business.device.toLowerCase().includes(device)));
}
function analysisLines(items){
 const groups=groupIssues(items), counts=new Map();
 for(const e of items){const c=e.business?.category;if(c)counts.set(c,(counts.get(c)||0)+1);}
 const recognized=items.filter(e=>e.business?.category).length;
 return [
  items.length?`观察时间：${items[0].time} 至 ${items.at(-1).time}（日志原始时间，时区未知）。`:'当前范围没有可识别日志，请调整筛选或检查导入明细。',
  `当前范围 ${items.length} 条日志，其中 ${recognized} 条识别为业务记录，${items.length-recognized} 条未识别业务。各业务分类互斥，加上未识别业务等于当前日志总数；业务记录数不代表操作次数。`,
  `原始等级：${Object.keys(logLevels).map(level=>`${logLevelLabel(level)} ${items.filter(e=>e.level===level).length} 条`).join('；')}。等级与疑似异常判断分开统计。`,
  ...(items.some(e=>e.level==='OTHER')?[`未知等级原始标签：${[...new Set(items.filter(e=>e.level==='OTHER').map(e=>e.rawLevel||'未提供'))].join('、')}；保留原文，不推断为错误或警告。`]:[]),
  `主要业务：${[...counts].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${businessNames[k]} ${n} 条`).join('；')||'未识别'}。`,
  `发现 ${groups.length} 类疑似异常，共 ${groups.reduce((n,g)=>n+g.items.length,0)} 条日志。${groups.length?'这是规则筛选结果，请通过证据确认实际影响。':'未发现疑似异常不代表没有问题。'}`,
  '当前仅依据日志中的明确字段分析；不能据此确认根因、用户影响或最终恢复。'
 ];
}
function renderEvidenceSummary(items){
 const box=$('analysisSummary');box.replaceChildren();
 const total=items.length, groups=groupIssues(items), issueCount=groups.reduce((n,g)=>n+g.items.length,0);
 const recognized=items.filter(e=>e.business?.category).length, stats=requestSummary(items);
 const first=items[0],last=items.at(-1);
 const section=(className,title,content)=>{const el=document.createElement('section');el.className=className;const heading=document.createElement('h3');heading.textContent=title;el.append(heading,content);return el;};
 const text=(value,className='')=>{const el=document.createElement('p');el.textContent=value;if(className)el.className=className;return el;};
 const lead=document.createElement('div');lead.className='evidenceLead';
 const leadLabel=document.createElement('span');leadLabel.className='evidenceKicker';leadLabel.textContent=issueCount?'需要优先核对':'当前没有高优先级异常';
 const leadTitle=document.createElement('strong');leadTitle.textContent=issueCount?`发现 ${issueCount.toLocaleString()} 条疑似异常记录`:'当前范围未发现疑似异常记录';
 const leadMeta=text(total?`覆盖 ${total.toLocaleString()} 条日志，异常记录占 ${(issueCount/Math.max(total,1)*100).toFixed(1)}%。`:'当前范围没有可识别日志。');
 lead.append(leadLabel,leadTitle,leadMeta);box.append(lead);
 const facts=document.createElement('div');facts.className='evidenceFacts';
 const fact=(label,value,detail)=>{const card=document.createElement('article');card.className='evidenceFact';const name=document.createElement('span');name.textContent=label;const number=document.createElement('strong');number.textContent=value;card.append(name,number,text(detail));facts.append(card);};
 fact('分析范围',total.toLocaleString(),first&&last?`${first.time} 至 ${last.time}`:'等待导入日志');
 fact('业务识别',recognized.toLocaleString(),`${(total-recognized).toLocaleString()} 条未识别业务记录`);
 fact('请求关联',stats.paired.toLocaleString(),`${stats.unmatched.toLocaleString()} 条未配对，${stats.ambiguous.toLocaleString()} 条冲突`);
 box.append(facts);
 const counts=new Map();for(const e of items){const c=e.business?.category;if(c)counts.set(c,(counts.get(c)||0)+1);}
 const businessRows=document.createElement('div');businessRows.className='evidenceRows';
 if(counts.size){for(const [key,count] of [...counts].sort((a,b)=>b[1]-a[1]).slice(0,6)){const row=document.createElement('div');const name=document.createElement('span');name.textContent=businessNames[key]||key;const value=document.createElement('strong');value.textContent=count.toLocaleString();row.append(name,value);businessRows.append(row);}}else businessRows.append(text('当前范围没有可识别业务。','evidenceEmpty'));
 box.append(section('evidenceBlock','业务分布',businessRows));
 const signal=document.createElement('div');signal.className=issueCount?'evidenceSignal evidenceSignalAlert':'evidenceSignal';
 signal.append(text(issueCount?`规则筛选出 ${groups.length} 类异常信号，共 ${issueCount.toLocaleString()} 条记录。`:'规则筛选未发现异常信号。'),text(issueCount?'请打开“疑似异常”查看证据和关联过程。':'日志等级与内容语义仍可继续通过筛选查看。','evidenceHint'));
 box.append(section('evidenceBlock','异常信号',signal));
 const notes=document.createElement('details');notes.className='evidenceNotes';const summary=document.createElement('summary');summary.textContent='分析口径与完整统计';notes.append(summary);
 const levels=Object.keys(logLevels).map(level=>`${logLevelLabel(level)} ${items.filter(e=>e.level===level).length} 条`).join('；');notes.append(text(`原始等级：${levels||'暂无记录'}。等级与疑似异常判断分开统计。`));
 if(items.some(e=>e.level==='OTHER'))notes.append(text(`未知等级原始标签：${[...new Set(items.filter(e=>e.level==='OTHER').map(e=>e.rawLevel||'未提供'))].join('、')}；保留原文，不推断为错误或警告。`));
 notes.append(text('当前仅依据日志中的明确字段分析，不能据此确认根因、用户影响或最终恢复。'));
 box.append(notes);
}
function coverageLine(){
 const ok=importReports.filter(r=>/^\d[\d,]* 条事件/.test(r.status)).length;
 const skipped=importReports.filter(r=>r.status.startsWith('跳过')).length;
 const containers=importReports.filter(r=>r.state==='container').length;
 return `收到 ${importReports.length} 个文件/条目（含 ${containers} 个 ZIP 容器）；识别事件 ${ok} 个；不支持 ${skipped} 个；未导入或未识别 ${importReports.length-ok-skipped-containers} 个。支持 .log / .txt 与普通 ZIP 内文本；无记录时段不等于日志丢失。`;
}
function renderInsights(){
 $('coverage').textContent=importReports.length?coverageLine():'导入日志后显示文件覆盖情况。';
 const issueCount=groupIssues(filtered).reduce((n,g)=>n+g.items.length,0);
 const total=filtered.length;
 const headline=$('signalHeadline'), meta=$('signalMeta');
 if(headline&&meta){
  if(!total){headline.textContent='等待导入日志';meta.textContent='导入后，这里会先告诉你当前范围最值得关注的变化。';}
  else if(issueCount){headline.textContent=`发现 ${issueCount.toLocaleString()} 条疑似异常日志，建议先看证据`;meta.textContent=`当前范围共 ${total.toLocaleString()} 条日志，疑似异常占 ${(issueCount/total*100).toFixed(1)}%。`}
  else {headline.textContent='当前范围未发现疑似异常日志';meta.textContent=`已分析 ${total.toLocaleString()} 条日志，可继续查看时间分布和业务记录。`;}
 }
 renderEvidenceSummary(filtered);
 renderFocus(groupIssues(filtered));
 $('exportBusiness').disabled=!currentBusinessEvents().length;
 $('exportReport').disabled=!filtered.length;
}
const originalReportFiles=reportFiles;
reportFiles=function(reports){importReports=reports;originalReportFiles(reports);};
const originalRenderBusiness=renderBusiness;
renderBusiness=function(){originalRenderBusiness();renderDiagnosis();};
function downloadAnalysis(name,payload,type='application/json'){
 const url=URL.createObjectURL(new Blob([typeof payload==='string'?payload:JSON.stringify(payload,null,2)],{type}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('exportBusiness').onclick=()=>downloadAnalysis('loglens-business.json',{tool:'LogLens',scope:'当前业务视图',note:'包含原始日志，共享前请检查敏感信息。',filters:{category:businessCategory,outcome:$('businessOutcome').value,device:$('businessDevice').value,query:$('search').value,module:$('module').value,level:$('level').value,kind:$('kind').value,scene:$('scene').value,timeWindow},events:currentBusinessEvents()});
$('locateTime').onclick=()=>{
 const input=$('problemTime');
 if(!input.value){$('timeNotice').textContent='请先填写问题发生时间。';return;}
 const stamp=Date.parse(input.value+'Z'), radius=Number($('timeRadius').value)*60000;
 if(!Number.isFinite(stamp)){$('timeNotice').textContent='时间无效，请重新填写。';return;}
 resetFilters();timeWindow=[stamp-radius,stamp+radius];applyFilters();
 $('timeNotice').textContent=`已清除其他筛选，定位到问题前后 ${radius/60000} 分钟。匹配 ${filtered.length} 条记录。`;
};
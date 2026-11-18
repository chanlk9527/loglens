// Default experience: a small set of leads, with details only on demand.
let focusLimit=3, focusSource=null, focusGroups=[], selectedIssue=null;
function issueHeadline(group){
 const e=group.items.at(-1),stage=stageNames[e.business?.stage];
 if(!e.business?.category){const hint=technicalHint(e);return hint.id==='unknown'?sourceLabel(e)+' 的异常记录':hint.label+' · '+sourceLabel(e);}
 return `${stage||diagnosticFor(e).label}出现${e.business?.outcome==='fail'?'失败记录':'异常线索'}`;
}
function shortRecovery(e,items){
 const insufficient=recoveryEligibility(e);if(insufficient)return insufficient;
 const result=recoveryEvidence(e,items);
 return result.status==='stage_success'?'同一操作的这个阶段随后记录成功，最终结果仍需确认。':result.status==='possible'?'同设备随后出现同阶段成功，但可能是另一次尝试。':'是否恢复还不确定，日志中没有找到可关联的后续成功记录。';
}
function selectedIssueEvidence(group,items){
 const last=group.items.at(-1),ids=new Set(group.items.map(e=>e.id));
 const related=items.filter(e=>{
  if(ids.has(e.id)||e.id===last.partner)return true;
  if(evidenceScope(e)!==evidenceScope(last)||e.business?.category!==last.business?.category)return false;
  if(last.operationId)return e.operationId===last.operationId;
  return !!last.business?.device&&e.business?.device===last.business.device&&Math.abs(e.stamp-last.stamp)<=300000;
 });
 return related.slice().sort((a,b)=>a.stamp-b.stamp||a.id-b.id);
}
function renderFocus(groups){
 if(focusSource!==filtered){focusLimit=3;focusSource=filtered;}
 focusGroups=groups;
 const loaded=importReports.length>0||events.length>0;
 $('focusResults').hidden=!loaded;
 $('issuesEmpty').hidden=loaded;
 const omitted=importReports.filter(r=>r.state?['unsupported','error','unrecognized'].includes(r.state):!/^\d[\d,]* 条事件/.test(r.status)).length;
 if(events.length&&!$('problemTime').value)$('problemTime').value=events[0].time.slice(0,19).replace(' ','T');
 $('quickCoverage').textContent=events.length?`${events[0].time.slice(0,19)} 至 ${events.at(-1).time.slice(0,19)}${omitted?` · ${omitted} 个文件或条目未分析，请查看导入明细。`:' · 已识别所导入的文本日志。'}`:loaded?'没有读到可分析的日志，请展开导入明细查看原因。':'支持 .log、.txt 和普通 ZIP；日志只在本机分析。';
 const active=['search','module','level','kind','scene'].some(id=>$(id).value)||!!timeWindow;
 $('focusScope').hidden=!active;
 $('scopeLabel').textContent=`当前有全局筛选，显示 ${filtered.length} / ${events.length} 条记录的分析结果。`;
 $('focusTitle').textContent=groups.length?'值得查看的异常记录':!events.length?'暂时无法分析':!filtered.length?'当前筛选没有匹配记录':'暂未发现明确的异常线索';
 $('issueGroupCount').textContent=groups.length?`${groups.length} 组异常记录，展示 ${Math.min(focusLimit,groups.length)} 组。按相似记录数排序，不代表故障数量或严重程度。`:events.length?'这不代表 App 一定正常；可切换到“日志检索”，按问题时间查看记录。':'请使用支持的文本日志，或先将 SDK 日志解码。';
 const list=$('issueCards');list.replaceChildren();
 for(const group of groups.slice(0,focusLimit)){
  const last=group.items.at(-1),card=document.createElement('article'),title=document.createElement('h3'),meta=document.createElement('p'),result=document.createElement('p'),actions=document.createElement('div');
  title.textContent=issueHeadline(group);
  meta.className='issueMeta';meta.textContent=`${sourceLabel(last)} · ${group.items.length} 条相似记录 · 最近 ${last.time.slice(0,19)}`;
  const excerpt=document.createElement('p');excerpt.className='issueExcerpt';excerpt.textContent=issueExcerpt(last);
  const basis=document.createElement('p');basis.className='issueBasis';basis.textContent='末条入选依据：'+issueReasons(last).join('；');
  result.textContent=shortRecovery(last,filtered);
  actions.className='actions';
  const open=document.createElement('button');open.className='primary';open.textContent=last.business?.category?'查看相关过程':'查看原文与依据';open.onclick=()=>openIssue(group);
  const report=document.createElement('button');report.textContent='导出此问题';report.onclick=()=>exportIssue(group);
  actions.append(open,report);card.append(title,meta,excerpt,basis,result,actions);list.append(card);
 }
 $('moreIssues').hidden=groups.length<=focusLimit;
 $('moreIssues').textContent=`再看 ${Math.min(5,Math.max(0,groups.length-focusLimit))} 组记录`;
}
function openIssue(group){
 selectedIssue=group;
 const last=group.items.at(-1),rule=diagnosticFor(last),items=selectedIssueEvidence(group,filtered);
 $('issueTitle').textContent=issueHeadline(group);
 $('issueCount').textContent=group.items.length.toLocaleString();$('issueFirst').textContent=group.items[0].time.slice(0,19);$('issueLast').textContent=last.time.slice(0,19);$('issueSource').textContent=sourceLabel(last);
 $('issueFinding').textContent=`判断依据：${issueReasons(last).join('；')}。${rule.impact}。摘要：${issueExcerpt(last)}`;
 $('issueRecovery').textContent=shortRecovery(last,filtered);
 $('issueNext').textContent=rule.next;
 $('issueAssociation').textContent=last.operationId?'下面展示本类线索及末次记录具有相同操作标识的过程。':last.business?.device?'下面展示本类线索及末次记录前后 5 分钟内的同设备记录；它们可能相关，但不一定是同一次操作。':'缺少明确操作或设备标识，只展示本类记录及可确认的配对响应，不拼接猜测的过程。';
 const flow=$('issueFlow');flow.replaceChildren();
 const display=items.slice().sort((a,b)=>Math.abs(a.stamp-last.stamp)-Math.abs(b.stamp-last.stamp)).slice(0,50).sort((a,b)=>a.stamp-b.stamp||a.id-b.id);
 for(const e of display){const row=document.createElement('div'),text=document.createElement('span'),button=document.createElement('button');
  text.textContent=`${e.time} · ${stageNames[e.business?.stage]||(sourceLabel(e)+' / '+diagnosticFor(e).label)} · ${outcomeNames[e.business?.outcome]||(e.issue?'异常线索':'记录')}`;
  button.textContent='查看原文';button.onclick=()=>openDetail(e.id);row.append(logLevelBadge(e.level),text,button);flow.append(row);
 }
 $('issueFlowCount').textContent=`关联 ${items.length} 条，展示距末次线索最近的 ${display.length} 条。导出包含全部关联记录。`;
 $('issueActual').value='';$('issueExpected').value='';$('issueNotes').open=false;
 if(!$('issueDialog').open)$('issueDialog').showModal();
}
function exportIssue(group,actual='',expected=''){
 const items=selectedIssueEvidence(group,filtered),files=new Set(items.map(e=>e.file));
 const reports=importReports.filter(r=>files.has(r.name));
 const report=buildReadableReport(items,reports,actual,expected).replace('范围：当前全局筛选。','范围：仅本类问题记录，以及末次记录的关联证据；来自当前筛选结果，不包含其他无关记录。');
 downloadAnalysis('loglens-issue.md',report,'text/markdown;charset=utf-8');
}
$('moreIssues').onclick=()=>{focusLimit+=5;renderFocus(focusGroups);};
$('resetFocus').onclick=()=>{resetFilters();comparison=[];workflowPage=0;renderChart();applyFilters();};
$('closeIssue').onclick=()=>$('issueDialog').close();
$('exportIssue').onclick=()=>{if(selectedIssue)exportIssue(selectedIssue,$('issueActual').value,$('issueExpected').value);};
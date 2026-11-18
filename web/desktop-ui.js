// Desktop-only enhancement. Browser analysis remains independently usable.
if(typeof window!=='undefined'&&window.loglensDesktop){
 (()=>{
  const bridge=window.loglensDesktop,el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const section=el('section');section.id='desktopDiagnosis';section.className='panel';
  const heading=el('div');heading.className='aiHeading';const title=el('div');title.append(el('h2','AI 日志诊断'),el('p','从问题出发，沿着证据一步步查清。'));heading.append(title);section.append(heading);
  const settings=el('details');settings.className='aiSettings';const settingsSummary=el('summary','模型连接'),connectionState=el('span','待配置');connectionState.className='aiConnectionState';settingsSummary.append(connectionState);settings.append(settingsSummary);const settingsGrid=el('div');settingsGrid.className='aiSettingsGrid';settings.append(settingsGrid);
  const field=(title,type,placeholder)=>{const label=el('label',title),input=el('input');input.type=type;input.placeholder=placeholder;input.autocomplete='off';label.className='aiField';label.append(input);settingsGrid.append(label);return input;};
  const base=field('API 根地址','url','https://模型服务地址/v1'),model=field('模型名称','text','模型 ID'),key=field('API Key','password','仅在当前进程保存');
  const save=el('button','应用配置'),configStatus=el('p','连接信息仅在本次运行中保存');const settingsFooter=el('div');settingsFooter.className='aiSettingsFooter';settingsFooter.append(configStatus,save);settings.append(settingsFooter);
  save.onclick=async()=>{try{await bridge.configure({baseUrl:base.value,model:model.value,apiKey:key.value});key.value='';configStatus.textContent='配置已应用';connectionState.textContent='已配置 · '+model.value;settings.open=false;}catch(e){configStatus.textContent=e.message;}};
  const conversation=el('div');conversation.id='aiConversation';conversation.setAttribute('aria-live','polite');
  let notesBody=el('div');notesBody.className='aiNoteBody';
  let progress=el('ol');progress.className='aiProgress';
  let result=el('div');result.id='aiResult';
  const question=el('textarea');question.id='aiQuestion';question.maxLength=4000;question.placeholder='描述问题，或回答 AI 的追问；可补充时间、设备、观察到的现象。';
  const label=el('label','问题或补充信息');label.append(question);
  const mode=el('select');mode.setAttribute('aria-label','调查预算');for(const [value,text]of [['quick','快速排查 · 最多12轮'],['deep','深入调查 · 最多32轮']]){const option=el('option',text);option.value=value;mode.append(option);}
  const start=el('button','发送并调查'),resume=el('button','继续调查'),fresh=el('button','新建调查'),stop=el('button','停止');
  start.id='aiStart';start.className='primary';stop.disabled=true;resume.disabled=true;
  const controls=el('div');controls.className='aiControls';const sendActions=el('div');sendActions.className='aiSendActions';sendActions.append(stop,start);controls.append(mode,sendActions);const secondaryActions=el('div');secondaryActions.className='aiSecondaryActions';secondaryActions.append(resume,fresh);
  const status=el('p');status.id='aiStatus';status.setAttribute('role','status');
  const intro=el('div');intro.className='aiIntro';intro.append(el('h3','遇到了什么问题？'),el('p','告诉我发生了什么、预期是什么。如果知道大致时间或设备，也可以一起补充。'));const composer=el('div');composer.className='aiComposer';composer.append(label,controls);const main=el('div');main.className='aiMain';main.append(intro,conversation,status,composer,secondaryActions);const workspace=el('div');workspace.className='aiWorkspace aiConversationLayout';workspace.append(main);const privacy=el('p','日志在本地检索，必要的脱敏片段会发送到配置的模型服务。请仅使用允许发送的数据。');privacy.className='aiPrivacy';section.append(settings,workspace,privacy);$('panel-ai').replaceChildren(section);
  const footer=document.querySelector('.localFootnote');if(footer)footer.textContent='本地分析不上传日志；AI 调查会发送问题与必要的脱敏证据到你配置的模型服务。';
  let source=null,datasetId=null,running=false,stopRequested=false,generation=0,newSession=true,hasSession=false,activeRun=null;
  function message(role,text){intro.hidden=true;const card=el('article');card.className='aiMessage';card.append(el('strong',role),el('p',text));conversation.append(card);}
  function beginRun(){
   const card=el('article');card.className='aiRun isRunning';card.setAttribute('aria-busy','true');
   const heading=el('div');heading.className='aiRunHeading';const dot=el('span');dot.className='aiRunDot';dot.setAttribute('aria-hidden','true');
   const title=el('strong','AI 正在调查'),clock=el('span','0 秒');clock.className='aiRunClock';heading.append(dot,title,clock);
   const latest=el('p','正在准备日志…');latest.className='aiRunLatest';latest.setAttribute('role','status');
   const recent=el('div');recent.className='aiRunRecent';
   const history=el('details');history.className='aiRunHistory';const historySummary=el('summary','执行记录');progress=el('ol');progress.className='aiProgress';history.append(historySummary,progress);
   const notes=el('details');notes.className='aiRunNotes';notes.open=true;notes.hidden=true;notes.append(el('summary','调查笔记'));notesBody=el('div');notesBody.className='aiNoteBody';notes.append(notesBody);
   const body=el('div'),meta=el('p');meta.className='aiRunMeta';card.append(heading,latest,recent,history,notes,body,meta);conversation.append(card);
   const run={card,title,clock,latest,recent,historySummary,notes,body,meta,started:Date.now(),steps:0,timer:null};
   run.timer=setInterval(()=>{clock.textContent=Math.floor((Date.now()-run.started)/1000)+' 秒';},1000);run.timer.unref?.();
   activeRun=run;card.scrollIntoView?.({block:'nearest',behavior:'smooth'});return run;
  }
  function finishRun(run,title,text,kind='done'){
   if(!run)return;clearInterval(run.timer);run.card.className='aiRun '+kind;run.card.setAttribute('aria-busy','false');run.title.textContent=title;
   run.clock.textContent=Math.floor((Date.now()-run.started)/1000)+' 秒';if(text)run.latest.textContent=text;
  }
  function refs(ids){const row=el('div');row.className='aiRefs';for(const id of ids){const button=el('button',id);button.onclick=()=>{if(source!==events){reset();return;}openDetail(Number(id.slice(1)));};row.append(button);}return row;}
  function renderNotes(value){if(activeRun)activeRun.notes.hidden=!(value.facts.length||value.hypotheses.length||value.openQuestions.length);notesBody.replaceChildren();for(const [key,title]of [['facts','日志观察'],['hypotheses','候选解释（非事实）']]){notesBody.append(el('h4',title));for(const item of value[key])notesBody.append(el('p',item.text),refs(item.evidenceIds));}notesBody.append(el('h4','待核对'));for(const text of value.openQuestions)notesBody.append(el('p',text));}
  function render(diagnosis){
   result.id='';result=el('div');result.id='aiResult';activeRun.body.append(result);result.append(el('h3',({insufficient_evidence:'当前证据不足',hypothesis:'候选解释，尚待验证',supported_stage:'有证据支持的问题环节'})[diagnosis.status]),el('p',diagnosis.summary));
   for(const item of diagnosis.observations)result.append(el('p',item.text),refs(item.evidenceIds));
   for(const item of diagnosis.hypotheses){result.append(el('h4','候选解释'),el('p',item.text),refs(item.evidenceIds),el('p','还缺：'+item.missingEvidence.join('；')));if(item.counterEvidenceIds.length)result.append(el('p','反证 / 冲突证据'),refs(item.counterEvidenceIds));}
   result.append(el('h4','限制与下一步'));for(const text of [...diagnosis.limitations,...diagnosis.nextChecks])result.append(el('p',text));
   result.append(el('p','引用存在不表示解释已经成立，请核对原文。后续证据可能改变此判断。'));
  }
  function reset(){finishRun(activeRun,'已停止','日志数据已变化','paused');activeRun=null;generation++;bridge.cancel().catch(()=>{});source=null;datasetId=null;hasSession=false;newSession=true;result.replaceChildren();conversation.replaceChildren();notesBody.replaceChildren();progress.replaceChildren();resume.disabled=true;intro.hidden=false;status.textContent='日志已就绪，可以开始新的调查。';}
  window.addEventListener('loglens-import-start',reset);
  bridge.onProgress(update=>{
   if(!running||!activeRun||update.datasetId!==datasetId)return;
   const text=update.message.replace('模型正在选择下一步调查动作','正在分析证据，决定下一步查询').replace(/\bsearch\b/g,'搜索日志').replace(/\bcontext\b/g,'查看上下文').replace(/\brelated\b/g,'查询关联记录').replace(/\baggregate\b/g,'汇总日志').replace(/\bcompare\b/g,'对比过程').replace(/\bread\b/g,'读取片段').replace(/\boverview\b/g,'查看概况');
   activeRun.latest.textContent=text;progress.append(el('li',text));activeRun.steps++;activeRun.historySummary.textContent='全部执行记录 · '+activeRun.steps+' 项';
   const previous=activeRun.recent.children.length?Array.from(activeRun.recent.children).slice(-2):[];activeRun.recent.replaceChildren(...previous,el('p',text));
   if(update.notes)renderNotes(update.notes);
  });
  stop.onclick=()=>{stopRequested=true;bridge.cancel().catch(()=>{});if(activeRun)activeRun.latest.textContent='正在停止，保留已获得的证据…';stop.disabled=true;};
  fresh.onclick=()=>{if(running)return;activeRun=null;newSession=true;hasSession=false;conversation.replaceChildren();result.replaceChildren();notesBody.replaceChildren();progress.replaceChildren();resume.disabled=true;intro.hidden=false;status.textContent='已新建调查，请描述问题。';question.focus();};
  async function send(text){
   if(running)return;if(busy){status.textContent='请等待日志导入完成。';return;}if(!events.length){status.textContent='请先导入日志或试用示例。';return;}if(!text.trim()){status.textContent='请填写问题或补充信息。';return;}
   running=true;stopRequested=false;start.disabled=fresh.disabled=mode.disabled=true;stop.disabled=false;resume.disabled=true;const current=++generation;message('你',text);const run=beginRun();status.textContent='';question.value='';
   try{
    if(source!==events||!datasetId){
     run.latest.textContent='正在准备本地日志数据集…';const importedSource=events;
     const imported=await bridge.importDataset({events:events.map(e=>({id:e.id,stamp:e.stamp,time:e.time,file:e.file,line:e.line,endLine:e.endLine,message:e.message,module:e.module,level:e.level,business:e.business,operationId:e.operationId,sessionId:e.sessionId,requestId:e.requestId,partner:e.partner,pairBasis:e.pairBasis})),reports:importReports.map(r=>({name:r.name,status:r.status,unmatched:r.unmatched}))});
     if(current!==generation)return;source=importedSource;datasetId=imported.datasetId;
    }
    if(stopRequested){finishRun(run,'已停止','本次未开始模型调查。','paused');return;}
    run.latest.textContent='正在分析问题与日志概况…';
    const answer=await bridge.diagnose({datasetId,question:text,mode:mode.value,newSession});
    if(current!==generation||source!==events||answer.datasetId!==datasetId)return;
    newSession=false;hasSession=true;renderNotes(answer.notes);
    if(answer.kind==='needs_input'){
     finishRun(run,'等待你的补充',answer.ask.question,'waiting');
     const options=el('div');for(const text of answer.ask.options){const button=el('button',text);button.onclick=()=>{if(!running)question.value=text;};options.append(button);}run.body.append(options);
     question.focus();
    }else if(answer.kind==='complete'){finishRun(run,'调查完成','已整理当前结论与证据，可继续追问。');render(answer.diagnosis);}
    else{finishRun(run,'调查已暂停',answer.message,'paused');}
    run.meta.textContent='累计模型调用 '+answer.calls+' 次；已报告 token '+(answer.usage.inputTokens+answer.usage.outputTokens)+'（供应商未返回用量时不计）。';
   }catch(e){if(current===generation){finishRun(run,'本次调查未完成',e.message,'failed');question.value=text;}}
   finally{clearInterval(run.timer);running=false;start.disabled=fresh.disabled=mode.disabled=false;stop.disabled=true;resume.disabled=!hasSession;if(current!==generation)status.textContent='旧调查已停止，可基于当前日志开始。';}
  }
  start.onclick=()=>send(question.value);
  resume.onclick=()=>send(question.value.trim()||'请基于当前证据和调查笔记继续。优先核对未解决的问题，必要时向我提问。');
 })();
}

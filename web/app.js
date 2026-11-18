const $ = id => document.getElementById(id);
let events=[], filtered=[], page=0, timeWindow=null, busy=false;
const pageSize=80;
const logLevels={D:{name:'调试',english:'Debug'},I:{name:'信息',english:'Info'},W:{name:'警告',english:'Warn'},E:{name:'错误',english:'Error'},OTHER:{name:'未知',english:'Unknown'}};
function logLevelKey(level){return Object.hasOwn(logLevels,level)?level:'OTHER';}
function logLevelLabel(level){const key=logLevelKey(level);return `${key} · ${logLevels[key].name}`;}
function logLevelBadge(level){
 const key=logLevelKey(level),badge=document.createElement('span');badge.className='logLevel level-'+key;
 badge.textContent=logLevelLabel(key);badge.title=`日志原始等级：${logLevels[key].english}（${key}）。与工具判断的异常线索分开显示。`;
 badge.setAttribute('aria-label','日志等级：'+logLevels[key].name+' '+key);return badge;
}
function levelText(target,e,text){const label=document.createElement('span');label.className='logEntryText';label.textContent=text;target.replaceChildren(logLevelBadge(e.level),label);target.classList.add('levelEntry');}
function workerMain(){
 self.onmessage=async({data})=>{
  const files=data.files||data, options=data.options||{};
  try{const result=await decodeInputs(files,(done,total)=>self.postMessage({type:'progress',done,total}),options);self.postMessage({type:'done',...result});}
  catch(error){self.postMessage({type:'error',message:error.message});}
 };
}
function reportFiles(reports){$('imports').hidden=false;$('filelist').replaceChildren();for(const r of reports){const d=document.createElement('div');d.textContent=r.name+' — '+r.status;$('filelist').append(d);}}
async function load(files){
 if(busy)return; files=Array.from(files);if(!files.length)return;
 const bytes=files.filter(f=>/\.(log|txt|zip)$/i.test(f.name)).reduce((n,f)=>n+f.size,0);
 if(bytes>100*1024*1024){$('status').textContent='本版单次支持最多 100 MB 文本 / ZIP 输入，请按日期分批导入。当前结果已保留。';return;}
 if(typeof window!=='undefined')window.dispatchEvent(new Event('loglens-import-start'));
 busy=true;$('files').disabled=$('folder').disabled=$('demo').disabled=true;$('status').textContent='正在解析…';$('progress').hidden=false;$('progress').value=0;$('progress').max=files.length;
 let worker,url;
 const cleanup=()=>{worker?.terminate();if(url)URL.revokeObjectURL(url);busy=false;$('files').disabled=$('folder').disabled=$('demo').disabled=false;$('progress').hidden=true;$('files').value=$('folder').value='';};
 try{
  url=URL.createObjectURL(new Blob([classifyAnomaly.toString(),'\n',createParser.toString(),'\n',correlate.toString(),'\n',unpackZip.toString(),'\n',decodeInputs.toString(),'\n(',workerMain.toString(),')()'],{type:'text/javascript'}));worker=new Worker(url);
  worker.onerror=()=>{cleanup();$('status').textContent='解析线程启动或执行失败。请尝试现代浏览器，或使用 README 中的本地静态预览方式。';};
  worker.onmessage=({data})=>{if(data.type==='error'){cleanup();$('status').textContent='解析失败：'+data.message;return;}if(data.type==='progress'){$('progress').max=data.total;$('progress').value=data.done;$('status').textContent=`正在解析 ${data.done} / ${data.total} 个文件…`;return;} cleanup();events=data.events;for(const e of events)classifyAnomaly(e,$('anomalyMode').value||'level');comparison=[];workflowPage=0;reportFiles(data.reports);resetFilters();fillOverview(data.stats);renderChart();applyFilters();$('status').textContent=`${files.length} 个文件 · ${events.length.toLocaleString()} 条日志`;$('export').disabled=!events.length;};
  worker.postMessage({files,options:{anomalyMode:$('anomalyMode')?.value||'level'}});
 }catch(e){cleanup();$('status').textContent='无法启动解析：'+e.message;}
}
function fmt(stamp){return new Date(stamp).toISOString().replace('T',' ').slice(0,19);}
function resetFilters(){for(const id of ['search','module','level','kind','scene'])$(id).value='';timeWindow=null;page=0;businessPage=0;$('businessOutcome').value='';$('businessDevice').value='';}
function fillOverview(stats){
 $('total').textContent=events.length.toLocaleString();$('issues').textContent=events.filter(e=>e.issue).length.toLocaleString();const mods=[...new Set(events.map(e=>e.module))].sort();$('modules').textContent=mods.length;$('requests').textContent=stats.pairs.toLocaleString();$('latency').textContent=stats.pairs?`平均 ${stats.average} ms`:'—';$('range').textContent=events.length?events[0].time.slice(0,10)+' 至 '+events.at(-1).time.slice(0,10):'无可识别日志';
 $('module').replaceChildren(new Option('全部模块',''));for(const m of mods)$('module').add(new Option(m,m));
}
function renderChart(){
 const chart=$('chart');chart.replaceChildren();if(!events.length){chart.textContent='暂无数据';$('startLabel').textContent=$('endLabel').textContent='—';return;}
 const first=events[0].stamp,last=events.at(-1).stamp, slots=Math.min(48,Math.max(1,Math.ceil((last-first)/60000))),width=Math.max(1,Math.ceil((last-first+1)/slots));const bins=Array.from({length:slots},()=>({total:0,issue:0}));
 for(const e of events){const b=bins[Math.min(slots-1,Math.floor((e.stamp-first)/width))];b.total++;if(e.issue)b.issue++;}
  const max=Math.max(...bins.map(b=>b.total));bins.forEach((b,i)=>{const button=document.createElement('button');button.className='bar';const lo=first+i*width,hi=lo+width;button.title=`${fmt(lo)} — ${fmt(hi)}\n${b.total} 条日志 / ${b.issue} 条疑似异常日志`;button.setAttribute('aria-label',button.title);const total=document.createElement('span'),bad=document.createElement('span');total.className='all';bad.className='bad';total.style.height=(b.total/max*100)+'%';bad.style.height=(b.issue/max*100)+'%';button.append(total,bad);button.onclick=()=>{timeWindow=[lo,hi];page=0;chart.querySelectorAll('.bar').forEach(x=>x.classList.remove('active'));button.classList.add('active');applyFilters();};chart.append(button);});$('startLabel').textContent=fmt(first);$('endLabel').textContent=fmt(last);
}
function applyFilters(){
 const q=$('search').value.toLowerCase(),mod=$('module').value,level=$('level').value,kind=$('kind').value;
 filtered=events.filter(e=>(!q||e.raw.toLowerCase().includes(q)||e.file.toLowerCase().includes(q))&&(!$('scene').value||e.business?.category===$('scene').value)&&(!mod||e.module===mod)&&(!level||e.level===level)&&(!kind||(kind==='issue'?e.issue:e.kind===kind))&&(!timeWindow||(e.stamp>=timeWindow[0]&&e.stamp<timeWindow[1])));
 $('timeFilter').textContent=timeWindow?`时间筛选：${fmt(timeWindow[0])} 至 ${fmt(timeWindow[1])}（不含结束时间）`:'';renderRows();businessPage=0;renderBusiness();
}
function renderRows(){
 const pages=Math.ceil(filtered.length/pageSize);page=Math.max(0,Math.min(page,pages-1));$('rows').replaceChildren();
 for(const e of filtered.slice(page*pageSize,(page+1)*pageSize)){
  const tr=document.createElement('tr');tr.dataset.id=e.id;tr.tabIndex=0;tr.className='logRow level-'+logLevelKey(e.level);tr.setAttribute('aria-label','查看事件 '+logLevelLabel(e.level)+' '+e.time+' '+e.module);const values=[e.time,e.level,e.module,e.message.split('\n')[0],e.duration===undefined?'—':e.duration+' ms'];values.forEach((v,i)=>{const td=document.createElement('td');if(i===1){td.append(logLevelBadge(e.level));}else td.textContent=v;td.title=v;tr.append(td);});tr.onclick=()=>openDetail(e.id);tr.onkeydown=k=>{if(k.key==='Enter')openDetail(e.id);};$('rows').append(tr);
 }
 if(!filtered.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.className='empty';td.textContent=events.length?'无匹配日志':'暂无日志';tr.append(td);$('rows').append(tr);}
 $('count').textContent=`匹配 ${filtered.length.toLocaleString()} / ${events.length.toLocaleString()} 条日志`;$('page').textContent=`${pages?page+1:0} / ${pages}`;$('prev').disabled=page===0;$('next').disabled=page>=pages-1;
}
function openDetail(id){const e=events[id];showBusinessFields(e);$('source').textContent=`${e.file} · 第 ${e.line}–${e.endLine} 行 · ${e.location}`;$('reason').textContent=e.reason;$('raw').textContent=e.raw;$('context').replaceChildren();if(e.partner!==undefined){const b=document.createElement('button');b.textContent=`查看配对${e.direction==='request'?'响应':'请求'} · ${e.duration} ms`;b.onclick=()=>openDetail(e.partner);$('context').append(b);}const siblings=events.filter(x=>x.file===e.file),idx=siblings.findIndex(x=>x.id===id);for(const n of siblings.slice(Math.max(0,idx-2),idx+3)){const b=document.createElement('button');b.textContent=(n.id===id?'▶ ':'')+n.time+' '+n.message.slice(0,180);b.onclick=()=>openDetail(n.id);$('context').append(b);}if(!$('detail').open)$('detail').showModal();}
for(const id of ['files','folder'])$(id).onchange=e=>load(e.target.files);
function applyAnomalyMode(){const mode=$('anomalyMode')?.value||'level';for(const e of events)classifyAnomaly(e,mode);$('issues').textContent=events.filter(e=>e.issue).length.toLocaleString();renderChart();applyFilters();}
$('anomalyMode').onchange=applyAnomalyMode;
for(const type of ['dragover','dragleave','drop'])$('drop').addEventListener(type,e=>{e.preventDefault();$('drop').classList.toggle('over',type==='dragover');if(type==='drop')load(e.dataTransfer.files);});
let debounce;for(const id of ['search','module','level','kind','scene'])$(id).addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(()=>{page=0;applyFilters();},id==='search'?180:0);});
$('clear').onclick=()=>{resetFilters();renderChart();applyFilters();};$('resetTime').onclick=()=>{timeWindow=null;page=0;renderChart();applyFilters();};$('prev').onclick=()=>{page--;renderRows();};$('next').onclick=()=>{page++;renderRows();};$('close').onclick=()=>$('detail').close();
$('export').onclick=()=>{const payload={tool:'LogLens',note:'疑似异常日志只是规则筛选结果，不代表根因结论；导出含原始日志，请按需脱敏。',filters:{query:$('search').value,module:$('module').value,level:$('level').value,kind:$('kind').value,scene:$('scene').value,timeWindow},events:filtered};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='loglens-analysis.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('demo').onclick=()=>{const demo=`[2026-11-17 11:37:28.650] [I📝] [Application:190 launch(in:)] [Application] launch 开始
[2026-11-17 11:37:28.670] [I📝] [:260 -[ThingSmartMQTTChannel didEnterForeground]] enter foreground
[2026-11-17 11:37:29.109] [I📝] [:1081 -[ThingSmartMQTTChannel handleEvent:event:error:]] connect success time consuming : 437
[2026-11-17 11:37:49.655] [I📝] [:275 -[ThingBaseApi sendRequest]_block_invoke] [baseapi] request: api = demo.login, commonParams = {
  "requestId" : "DEMO-REQUEST-001",
  "appVersion" : "demo"
}
[2026-11-17 11:37:49.807] [I📝] [:298 -[ThingApi handleSuccess:object:]] [api] response: api = demo.login requestId:DEMO-REQUEST-001 success
[2026-11-17 11:38:10.000] [D🛠] [LoginCodeInputViewModel:229 getEmailCode(email:complete:onFailure:)] getEmailCode error:URLSessionTask failed with error: 请求超时。
[2026-11-17 11:38:20.000] [E❌] [MeariProvisionModule:164 reportScanFailure(_:error:)] 阶段=ble_scan，结果=fail，diagnostic_code:MEARI_SCAN_LOGIN_FAILED
[2026-11-17 11:38:23.000] [D🛠] [BTManager:602 disconnectAllEntity()] 断开所有设备连接
[2026-11-17 11:39:00.000] [I📝] [LTRNFullBundleRuntime:52 prepareIfNeeded()] [RNFullRuntime] jsDidLoad elapsedMs=2589
[2026-11-17 11:39:00.002] [I📝] [LTRNFullBundleRuntime:188 registerEmbeddedAssetsIfNeeded(bridge:)] [RNFullRuntime] register full assets failed: batchedBridge 不可用`;
load([new File([demo+businessDemo],'演示数据-按实际格式构造.log',{type:'text/plain'})]);};
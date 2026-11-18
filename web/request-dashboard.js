let requestDashboardPage=0;
function requestPairs(items){
 const byId=new Map(events.map(e=>[e.id,e])), seen=new Set(), result=[];
 for(const e of items.filter(x=>x.direction)){
  if(seen.has(e.id))continue;
  const partner=e.partner!==undefined?byId.get(e.partner):null;
  const group=e.pairStatus==='ambiguous'?'ambiguous':partner?'paired':'unmatched';
  const first=e.direction==='request'?e:partner||e, second=e.direction==='response'?e:partner;
  const ids=[e.id,partner?.id].filter(id=>id!==undefined);ids.forEach(id=>seen.add(id));
  result.push({id:e.id,status:group,request:first.direction==='request'?first:null,response:second?.direction==='response'?second:null,duration:e.duration??second?.duration??null});
 }
 return result.sort((a,b)=>(b.request||b.response).stamp-(a.request||a.response).stamp);
}
function renderRequestDashboard(){
 const source=$('requestSource').value || 'cozy';
 const all=requestPairs(filtered).filter(pair=>{
  const cozy=Boolean(pair.request?.cozyRequest || pair.response?.cozyRequest);
  return source==='all' || (source==='cozy' ? cozy : !cozy);
 });
 const status=$('requestStatus').value,query=$('requestQuery').value.trim().toLowerCase();
 const pairs=all.filter(p=>!status||p.status===status).filter(p=>{const s=[p.request?.api,p.response?.api,p.request?.requestHost,p.response?.requestHost,p.request?.requestId,p.response?.requestId,p.request?.file,p.response?.file].join(' ').toLowerCase();return !query||s.includes(query);});
 const counts={paired:all.filter(p=>p.status==='paired').length,unmatched:all.filter(p=>p.status==='unmatched').length,ambiguous:all.filter(p=>p.status==='ambiguous').length};
 const metrics=$('requestMetrics');metrics.replaceChildren();for(const [key,label] of [['paired','已配对'],['unmatched','未配对'],['ambiguous','冲突']]){const card=document.createElement('article');card.className='requestMetric '+key;const name=document.createElement('span');name.textContent=label;const value=document.createElement('strong');value.textContent=counts[key].toLocaleString();card.append(name,value);metrics.append(card);}const durations=all.filter(p=>p.status==='paired'&&p.duration!==null).map(p=>p.duration).sort((a,b)=>a-b);const avg=durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null;const latency=document.createElement('article');latency.className='requestMetric latency';latency.innerHTML='<span>平均响应耗时</span><strong>'+(avg===null?'—':avg+' ms')+'</strong>';metrics.append(latency);
 $('requestNotice').textContent=`当前范围 ${all.length.toLocaleString()} 组请求记录，显示 ${pairs.length.toLocaleString()} 组。未配对不代表失败，冲突记录不会自动关联。`;
 const rows=$('requestRows');rows.replaceChildren();const pages=Math.ceil(pairs.length/20);requestDashboardPage=Math.max(0,Math.min(requestDashboardPage,pages-1));
 for(const p of pairs.slice(requestDashboardPage*20,requestDashboardPage*20+20)){const row=document.createElement('article');row.className='requestRow '+p.status;const head=document.createElement('div');head.className='requestRowHead';const badge=document.createElement('span');badge.className='requestStatusBadge';badge.textContent=p.status==='paired'?'已配对':p.status==='ambiguous'?'冲突':'未配对';const api=document.createElement('strong');api.textContent=p.request?.api||p.response?.api||'未记录接口';const basis=document.createElement('span');basis.className='requestBasis';const pairBasis=p.request?.pairBasis||p.response?.pairBasis;basis.textContent=pairBasis==='requestId_scope_fallback'?'同ID推定':pairBasis==='api_time_fallback'?'时间/API推定':'';const time=document.createElement('time');time.textContent=(p.request||p.response).time;head.append(badge,api);
  const endpoint=p.request?.requestHost || p.response?.requestHost || ((p.request||p.response).cozyRequest?'按 /api/app 路径识别':'');
  if(endpoint){const host=document.createElement('small');host.textContent=endpoint;head.append(host);}
  if(basis.textContent)head.append(basis);head.append(time);const body=document.createElement('div');body.className='requestRowBody';const req=document.createElement('button');req.textContent='请求 '+(p.request?.requestId||'无 requestId')+(p.request?' · '+p.request.time:' · 缺失');req.onclick=()=>p.request&&openDetail(p.request.id);const res=document.createElement('button');res.textContent=(p.response?.networkError?'请求错误 ':'响应 ')+(p.response?.requestId||'无 requestId')+(p.response?' · '+p.response.time:' · 缺失');res.onclick=()=>p.response&&openDetail(p.response.id);const elapsed=document.createElement('span');elapsed.className='requestElapsed';elapsed.textContent=p.duration===null?'—':p.duration+' ms';body.append(req,res,elapsed);row.append(head,body);rows.append(row);}
 if(!pairs.length)rows.textContent='当前筛选没有请求记录。';$('requestPage').textContent=`${pages?requestDashboardPage+1:0} / ${pages}`;$('requestPrev').disabled=requestDashboardPage===0;$('requestNext').disabled=requestDashboardPage>=pages-1;
}
$('requestSource').onchange=()=>{requestDashboardPage=0;renderRequestDashboard();};
$('requestStatus').onchange=()=>{requestDashboardPage=0;renderRequestDashboard();};$('requestQuery').oninput=()=>{requestDashboardPage=0;renderRequestDashboard();};$('requestPrev').onclick=()=>{requestDashboardPage--;renderRequestDashboard();};$('requestNext').onclick=()=>{requestDashboardPage++;renderRequestDashboard();};
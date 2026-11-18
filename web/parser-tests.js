// Regression checks for record boundaries, classification and count consistency.
(async()=>{
 const check=(value,message)=>{if(!value)throw Error(message);};
 const head=(message='',module='Test',level='I',time='2026-11-17 10:00:00.000')=>`[${time}] [${level}] [${module}:1 run()]${message?' '+message:''}`;
 const parse=(lines,mode='level')=>{const p=createParser('test.log',{anomalyMode:mode});for(const line of lines)p.line(line);return p.finish();};
 const levels=['D🛠','I📝','W⚠️','E❌','🧩','ERROR','warning','Debug','Info','Unexpected','ErrorCustom'];
 const expected=['D','I','W','E','OTHER','E','W','D','I','OTHER','OTHER'];
 const severity=parse(levels.map(level=>head('', 'Test',level))).events;
 check(severity.length===levels.length,'empty messages must not merge or disappear');
 severity.forEach((e,i)=>check(e.level===expected[i]&&e.rawLevel===levels[i],'source level decoding '+levels[i]));
 const boundary=parse([head('first'),head(),head('third'), 'stack line', head('bad date','Test','I','2026-02-30 10:00:00.000'),'orphan',head('last','Test','I','2026-11-17 10:00:01')]);
 check(boundary.events.length===4&&boundary.unmatched===2&&boundary.invalidHeaders===1,'invalid header quarantined without dropping valid file');
 check(boundary.events[2].endLine===4&&boundary.events[2].message==='third\nstack line','multiline boundaries retain exact source lines');
 check(boundary.events.at(-1).time==='2026-11-17 10:00:01.000','second precision normalized');
 const malformed=parse([head('before'),'[2026-11-17 broken header',head('after')]);
 check(malformed.events.length===2&&malformed.unmatched===1&&!malformed.events[0].message.includes('broken'),'malformed dated header cannot hide in previous message');
 const categories=[
  ['MeariProvisionModule','阶段=ble_scan，结果=success','provision'],
  ['MeariManager','【觅睿】Registry 镜像同步',''],
  ['MeariAuthGate','【觅睿】invalidateRedirectSession','auth'],
  ['IotKitProviderAuthService','[IotKit] 觅睿登录成功（Gate）','auth'],
  ['AuthSessionEventLogger','[AuthSession] 类型=自动','auth'],
  ['VerifyCodeSendSession','sendVerifyCode','auth'],
  ['ThingSmartBLEManager(Biz)','stop scan','bluetooth'],
  ['ThingSmartOSBLEManager','scan','bluetooth'],
  ['ThingASActivatorBleService','scan','bluetooth'],
  ['BM08SBLEManager','connect','bluetooth'],
  ['BT+Extension','status','bluetooth'],
  ['LTDevicesViewModel+Pump','[PUMP] state','pump'],
  ['LegacyPumpIslandAvailabilityCenter','reload','pump'],
  ['ThingSmartMQTTChannel','payload mentions 觅睿 BTManager','mqtt'],
  ['LTRNFullBundleRuntime','payload mentions MeariProvisionModule','rn'],
  ['Generic','response body: {"module":"MeariProvisionModule", "message":"觅睿"}',''],
  ['Logger','【觅睿】阶段=ble_scan，结果=start','provision'],
  ['ThingBaseApi','[baseapi] request: api = user.uid.token.create','auth']
 ,['IpcDeviceCellViewModel+Session','[IPC][ltrtc-DEVICE-1] 列表页离开，停止拉流','stream']
 ,['LTRTCLog','[LTRTC][BM08SDeviceManager] ICE restart offer failed: custom("restart_no_answer")','stream']
 ,['LTRTCPeerClient+DataChannel','[DataChannel] 初始化完成 label=bm08s-control','stream']
 ];
 for(const [module,message,expected]of categories){const e=parse([head(message,module)]).events[0];check(e.business.category===expected,'business identity: '+module);}
 const stream=parse([
  head('[IPC][ltrtc-DEVICE-1] session create (manager)','FunIotLog'),
  head('[IPC][ltrtc-DEVICE-1] 列表页离开，停止拉流','IpcDeviceCellViewModel+Session'),
  head('[LTRTC][BM08SDeviceManager] ICE restart offer failed: custom("restart_no_answer")','LTRTCLog','E')
 ]).events;
 check(stream[0].business.stage==='session_create'&&stream[0].business.device==='DEVICE-1','stream session device extraction');
 check(stream[1].business.stage==='pull_stop'&&stream[1].business.direction==='pull'&&stream[1].business.outcome==='stop','stream pull stop classification');
 check(stream[2].business.stage==='ice_restart'&&stream[2].business.outcome==='fail'&&stream[2].issue,'stream ICE failure classification');
 const targets=parse([
  head('status request url=https://app-api-bbm-hk-test.cozyinnov.com/api/app/device/status?model=BM04'),
  head('[Group] response envelope path=/api/app/device/status'),
  head('GET https://other.example/api/app/device/status'),
  head('avatar=https://cozy-static-dev.cozyinnov.com/image.png'),
  head('network failed'),
  'NSErrorFailingURLStringKey=https://app-api-bbm-hk-test.cozyinnov.com/api/app/ipc/stream/enableLiveStream',
  head('request: api = smartlife.m.api.batch.invoke')
 ]).events;
 check(targets[0].cozyRequest&&targets[0].api==='/api/app/device/status'&&targets[0].direction==='request','Cozyinnov request URL');
 check(targets[1].cozyRequest&&targets[1].direction==='response','relative Cozyinnov response');
 check(!targets[2].cozyRequest&&!targets[3].direction&&targets[4].networkError,'explicit host, resource reference, and network error');
 correlate(targets);events=targets;filtered=targets;
 for(const [source,count] of [['cozy',2],['other',2],['all',4]]){
  $('requestSource').value=source;renderRequestDashboard();
  check($('requestRows').children.length===count,'request source filter '+source);
 }
 $('requestSource').value='cozy';
 const inferred=parse([
  head('request: api = demo.api','ThingBaseApi','I','2026-11-17 10:00:00.000'),
  head('response: api = demo.api requestId:ABC-123 success','ThingApi','I','2026-11-17 10:00:00.120')
 ]).events;
 const inferredStats=correlate(inferred);
 check(inferredStats.pairs===1&&inferred[0].partner===inferred[1].id&&inferred[0].pairBasis==='api_time_fallback'&&inferred[0].duration===120,'API/time fallback pairing without request ID on request');
 const sessionMismatch=parse([
  head('request: api = demo.api requestId:XYZ-789 sessionId:SDK-1','ThingBaseApi','I','2026-11-17 10:00:01.000'),
  head('response: api = demo.api requestId:XYZ-789 success','ThingApi','I','2026-11-17 10:00:01.120')
 ]).events;
 const sessionMismatchStats=correlate(sessionMismatch);
 check(sessionMismatchStats.pairs===1&&sessionMismatch[0].pairBasis==='requestId_scope_fallback'&&sessionMismatch[0].duration===120,'same-file pairing tolerates missing response session ID');
 check(parse(['[2026-11-17 10:00:00.000] [I] [:464 -[ThingMessageHandleService mqttChannel:connectState:error:]] connected']).events[0].business.category==='mqtt','explicit MQTT callback identity');
 check(parse(['[2026-11-17 10:00:00.000] [I] [LibsManager:140 setupGeetest()] config']).events[0].business.category==='auth','explicit captcha method identity');
 const messages=[head('normal'),head('request failed'),head('阶段=ble_scan，结果=fail','MeariProvisionModule'),head('subscribe ack suc:0','ThingSmartMQTTChannel'),head('warning','Test','W'),head('error','Test','E')];
 events=parse(messages).events;correlate(events);filtered=events;resetFilters();
 const counted=()=>groupIssues(filtered).reduce((n,g)=>n+g.items.length,0);
 $('anomalyMode').value='level';applyAnomalyMode();
 check($('issues').textContent==='1'&&counted()===1,'level-only overview and groups agree');
 $('anomalyMode').value='content';applyAnomalyMode();
 check($('issues').textContent==='4'&&counted()===4,'content-mode overview and groups refresh together');
 const direct=parse(messages,'content').events;
 check(events.every((e,i)=>e.issue===direct[i].issue&&e.business.outcome===direct[i].business.outcome),'toggling matches parsing directly in selected mode');
 $('kind').value='issue';applyFilters();check(filtered.length===4,'issue filter uses same count');
 $('anomalyMode').value='level';applyAnomalyMode();check(counted()===1&&filtered.length===1,'switching back clears semantic candidates');
 check(!events[1].business.outcome,'derived candidate outcome resets with mode');
 $('kind').value='';applyFilters();businessCategory='';renderBusiness();
 check(currentBusinessEvents().length===4,'unclassified tab includes every unmatched business record');
 check($('businessPage').textContent.endsWith('4 条'),'unclassified tab page count');
 const sum=Object.keys(businessNames).reduce((n,key)=>n+events.filter(e=>e.business.category===key).length,0);
 check(sum===events.length,'business categories including unclassified partition all records');
 const sample='prefix\n'+head('中文','Test','W⚠️')+'\r\ncontinuation\r\n'+head('', 'Test','E❌')+'\n';
 const bytes=new TextEncoder().encode(sample);
 const streamed=await decodeInputs([{name:'chunked.log',size:bytes.length,stream(){let offset=0;return new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,++offset));}});}}],()=>{});
 check(streamed.events.length===2&&streamed.reports[0].unmatched===1&&streamed.reports[0].lineCount===4,'byte-by-byte UTF-8 / CRLF stream accounting');
 check(streamed.events[0].message==='中文\ncontinuation'&&streamed.events[1].level==='E','multibyte symbols across chunk boundaries');
 // A mode change while the worker is running must apply to the arriving result.
 let pendingWorker;
 globalThis.Worker=class {constructor(){pendingWorker=this;}postMessage(){}terminate(){}};
 const delayedFile=new File([head('request failed')],'delayed.log');
 $('anomalyMode').value='level';await load([delayedFile]);
 $('anomalyMode').value='content';
 const delayed=await decodeInputs([delayedFile],()=>{},{anomalyMode:'level'});
 pendingWorker.onmessage({data:{type:'done',...delayed}});
 check(events[0].issue&&$('issues').textContent==='1'&&groupIssues(filtered).length===1,'worker completion honors current anomaly mode');
 delete globalThis.Worker;
 businessCategory='provision';events=[];filtered=[];resetFilters();$('anomalyMode').value='level';
 console.log('PASS: original levels, empty/malformed headers, module-based business identity, anomaly toggle/filter/group parity, unclassified totals and UTF-8 chunk boundaries.');
})()
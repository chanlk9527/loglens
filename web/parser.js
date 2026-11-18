/* Shared by the browser worker and parser tests. No network access. */
function classifyAnomaly(e, mode='level') {
  const contentIssue=/(?:\bfailed\b|\bfailure\b|\berror\s*:|结果\s*=\s*fail|失败|请求超时|连接超时|timed out|no_answer|ICE restart offer failed|business_timeout)/i.test(e.message||'');
  if(e.business?.outcome==='candidate')e.business.outcome='';
  e.issue=e.level==='E'||(mode==='content'&&(contentIssue||e.business?.outcome==='fail'));
  e.reason=e.issue?(e.level==='E'?'日志标记为 Error。请结合上下文确认影响。':'消息或业务字段包含失败语义；当前使用“等级 + 内容”判断。'):'';
  if(e.issue&&e.business&&!e.business.outcome)e.business.outcome='candidate';
}
function createParser(file, options={}) {
  const anomalyMode=options.anomalyMode||'level';
  let eventCount=0;
  function readNetworkTarget(e) {
    const line=e.message.split('\n',1)[0];
    // Mapping a response envelope is a second local processing step.
    if (/^\[Group\] mapped response\b/i.test(line)) return;
    const failure=e.message.match(/\bNSErrorFailingURL(?:String)?Key\s*=\s*(https?:\/\/[^\s,}"<>]+)/i);
    const target=failure || line.match(/\b(?:url|path|api)\s*[:=]\s*["']?(https?:\/\/[^\s"',}<>]+|\/api\/app\b[^\s"',}<>]*)/i)
      || line.match(/(?:\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|request|response)\s*[: ]\s*|^)(https?:\/\/[^\s"',}<>]+|\/api\/app\b[^\s"',}<>]*)/i);
    if (!target) return;
    const absolute=target[1].match(/^https?:\/\/([a-z0-9.-]+)(?::\d+)?(?=[/?#]|$)([^?#]*)/i);
    if (!absolute && !target[1].startsWith('/api/app')) return;
    const host=absolute?.[1].toLowerCase() || '';
    const path=absolute ? absolute[2] || '/' : target[1].split(/[?#]/,1)[0];
    let direction=e.direction;
    if (failure || /\b(?:response|failed|code\s*[:=])\b/i.test(line) || e.module==='NetworkResponseHandler') direction='response';
    else if (/\b(?:request|GET|POST|PATCH|PUT|DELETE|HEAD)\b/i.test(line)) direction='request';
    else if (e.module==='BbmUiVersionSyncService' && /\b(?:status|add) url=/.test(line)) direction='response';
    else if (!direction && /^\/api\/app(?:\/|$)/.test(path) && /^(?:\/api\/app\b|(?:path|api|url)\s*[:=])/i.test(line)) direction='request';
    if (!direction) return;
    e.direction=direction;
    e.requestHost=host;
    e.cozyRequest=host ? /(?:^|\.)cozyinnov\.com$/.test(host) : /^\/api\/app(?:\/|$)/.test(path);
    if (!e.api || e.cozyRequest) e.api=path;
    if (failure) e.networkError=true;
  }
  function business(e) {
    const t=e.message;
    const value=key=>(t.match(new RegExp('(?:^|[\\s,，{;])"?'+key+'"?\\s*[:=]\\s*(?:"([^"\\n]*)"|([^\\s,;，}]+))'))||[]).slice(1).find(v=>v!==undefined) || '';
    const b={category:'',stage:'',outcome:'',device:'',fields:{}};
    const add=(label,v)=>{if(v!==''&&v!==undefined)b.fields[label]=v;};
    const stage=t.match(/阶段\s*=\s*([\w.-]+)/)?.[1];
    // Prefer the emitting module. Payload mentions must not override its identity.
    const moduleCategory=/^MeariProvision/.test(e.module)?'provision':
      /^(?:IpcDeviceCellViewModel\+Session|FunIotLog|LTRTCLog|LTRTCPeerClient|LTRTCSession|BM08SDeviceManager|BBMPlaybackActor)/i.test(e.module)?'stream':
      /^(?:PumpActivity|PumpFloating|TPumpLiveActivity|M5ProPumpPresentation|LTPumpM5ProIsland|LegacyPumpIsland|LTDevicesViewModel\+Pump)/.test(e.module)?'pump':
      /Thing.*MQTT/i.test(e.location)?'mqtt':
      /^(?:BTManager|BT\+|BLELiveActivityRecovery|Thing(?:Smart(?:OS)?BLE|BLE|Ble|AuthorizationBluetooth|ASActivatorBle)|BM08SBLE|BLEDeviceConnect|LTDevicesViewModel\+BLEScan)/.test(e.module)?'bluetooth':
      /^(?:LT)?RN(?:Full|Ota|Reach|Bundle)/.test(e.module)?'rn':
      /^(?:LoginCodeInput|CodeInputViewModel|VerifyCodeSendSession|AuthSessionEventLogger|NewFlowAuth|EmailOrPhoneInput|MeariAuthGate|IotKitProviderAuthService|AppTokenRenewalManager|PostLoginFlow)/.test(e.module)||/\b(?:setupGeetest|getEmailCode)\s*\(/.test(e.location)?'auth':'';
    const tagCategory=/^\s*【觅睿】[^\n]*阶段\s*=/.test(t)?'provision':
      /^\s*(?:\[IPC\]|\[LTRTC\]|\[BBMPlaybackActor\])/.test(t)||/(?:拉流|推流|停流|DataChannel|ICE restart|no_answer)/i.test(t)?'stream':
      /^\s*(?:\[PUMP\]|\[LegacyPumpIsland\]|PumpActivity\b)/.test(t)?'pump':
      /^\s*\[mqtt\]/i.test(t)?'mqtt':/^\s*\[BT\+?\]/.test(t)?'bluetooth':
      /^\s*\[RN(?:FullRuntime|Reach|Ota[^\]]*|Bundle[^\]]*)?\]/.test(t)?'rn':
      /^\s*\[AuthSession\]/.test(t)||/\b(?:setupGeetest|getEmailCode)\s*[:(]/.test(t)||/user\.uid\.(?:token|password)/.test(e.api)?'auth':'';
    b.category=moduleCategory||tagCategory;
    b.basis=moduleCategory?'来源模块':tagCategory?'明确消息标签或接口':'';
    if(b.category==='provision'){
      b.category='provision'; b.stage=stage||(/停止扫描/.test(t)?'stop_scan':/清除定时器/.test(t)?'clear_timer':'sdk_event');
      b.outcome=t.match(/结果\s*=\s*([\w]+)/)?.[1]||'';
      for(const [key,label] of [['diagnostic_code','诊断码'],['error_code','错误码'],['device_count','设备数']])add(label,value(key));
    }else if(b.category==='pump'){
      b.category='pump'; b.stage=t.match(/action[：:]\s*([^\s]+)/)?.[1]||'activity';
      for(const [key,label] of [['reason','触发来源'],['devices','设备数'],['snapshots','快照数'],['active','浮窗激活'],['running','运行中'],['elapsed','计时值'],['ended','清理数']])add(label,value(key));
    }else if(b.category==='mqtt'){
      b.category='mqtt';
      b.stage=/subscribe ack/i.test(t)?'subscribe_ack':/connect success time consuming/.test(t)?'connected':/start connect with host/.test(t)?'connect':/reconnect cancel/.test(t)?'reconnect_skipped':/reconnect/i.test(t)?'reconnect':/disconnect|connectionClosed/i.test(t)?'disconnected':/subscribe/i.test(t)?'subscribe':'transport';
      b.outcome=b.stage==='connected'?'success':/subscribe ack.*suc:1/.test(t)?'success':/subscribe ack.*suc:0/.test(t)?'fail':'';
      add('连接耗时 ms',t.match(/connect success time consuming\s*:\s*(\d+)/)?.[1]);
      for(const [key,label] of [['host','主机'],['networkStatus','网络'],['totalTime','总耗时 ms'],['sslTime','SSL 耗时 ms'],['ackTime','ACK 耗时 ms']])add(label,value(key));
    }else if(b.category==='stream'){
      const pull=/拉流|preview|playback|播放|接收|下行/i.test(t);
      const push=/推流|publish|上行|sendTrack|本地采集/i.test(t);
      b.category='stream';
      b.direction=push?'push':pull?'pull':'';
      add('方向',b.direction==='push'?'推流':b.direction==='pull'?'拉流':'');
      b.stage=/session create|初始化Session成功/i.test(t)?'session_create':
        /session release|Session 已释放|释放.*Session/i.test(t)?'session_release':
        /停止拉流|强制停流|teardownPreview|stopPreview/i.test(t)?'pull_stop':
        /开始拉流|startPreview|start.*preview|拉流开始/i.test(t)?'pull_start':
        /推流开始|start.*publish|publish.*start/i.test(t)?'push_start':
        /推流停止|stop.*publish|publish.*stop/i.test(t)?'push_stop':
        /DataChannel|data channel/i.test(t)?'data_channel':
        /ICE restart|ice.*restart/i.test(t)?'ice_restart':
        /connectError|didConnectError|no_answer|连接失败/i.test(t)?'connect_error':
        /configurePlaybackActor|PlaybackActor/i.test(t)?'playback_config':
        /初始化Session|bootstrapSession/i.test(t)?'session_init':'stream_event';
      b.outcome=/no_answer|connectError|didConnectError|失败|failed|error/i.test(t)?'fail':
        /成功|success|✅|connected/i.test(t)?'success':
        /开始|create|初始化|start/i.test(t)?'start':
        /停止|释放|结束|teardown|stop/i.test(t)?'stop':'';
      const streamDevice=t.match(/\[ltrtc-([^\]\s]+)\]/i)?.[1]||t.match(/\b(?:dev|deviceId)\s*[=:]\s*([\w-]+)/i)?.[1]||'';
      b.device=streamDevice;
      for(const [key,label] of [['sid','会话标识'],['sessionId','会话标识'],['deviceId','设备标识'],['reason','原因'],['message','错误信息'],['sinceSDKStartMs','SDK耗时 ms'],['phaseElapsedMs','阶段耗时 ms'],['batchElapsedMs','批次耗时 ms'],['error','错误']])add(label,value(key));
    }else if(b.category==='bluetooth'){
      b.category='bluetooth';b.stage=/断开所有/.test(t)?'disconnect_all':/断开/.test(t)?'disconnect':/连接设备/.test(t)?'connect':/开始扫描/.test(t)?'scan_start':/停止扫描/.test(t)?'scan_stop':value('event')||'bluetooth_event';
      b.device=t.match(/Optional\("([^"\n]+)"\)/)?.[1]||'';
      for(const [key,label] of [['deviceType','设备类型'],['autoReconnect','自动重连'],['flag','开关'],['result','结果']])add(label,value(key));
    }else if(b.category==='rn'){
      b.category='rn';b.stage=/jsDidLoad elapsedMs/.test(t)?'js_loaded':/register.*assets failed/.test(t)?'assets_failed':/rn_ota_version_reach/.test(t)?'version_reach':/deniedByGate|gate deny/.test(t)?'gate_denied':/prepareIfNeeded/.test(t)?'prepare':'ota_event';
      b.outcome=b.stage==='js_loaded'?'success':b.stage==='assets_failed'?'fail':b.stage==='gate_denied'?'skipped':'';
      for(const [key,label] of [['elapsedMs','加载耗时 ms'],['ms','加载耗时 ms'],['embeddedVersion','内置版本'],['ver','资源版本'],['resId','资源'],['sessionMode','加载模式'],['size','大小 bytes'],['sticky','版本固定']])add(label,value(key));
    }else if(b.category==='auth'){
      b.stage=/getEmailCode/.test(e.location+' '+t)?'email_code':/setupGeetest/.test(e.location+' '+t)?'captcha_config':/token\.create/.test(e.api)?'token_create':/MeariAuthGate|IotKitProviderAuthService/.test(e.module)?'sdk_login':'login';
      b.outcome=e.direction==='request'?'start':e.direction==='response'&&/\bsuccess\b/.test(t)?'success':'';
    }
    b.device=b.device||value('devId')||value('device_id');
    // deviceId in SDK commonParams identifies the phone, not the connected product.
    add('设备',b.device);add('阶段',stage);if(b.category)add('requestId',e.requestId);
    e.operationId=value('operationId')||value('attemptId')||value('provisionId');
    e.sessionId=value('sessionId')||value('sid');
    e.business=b;
    e.environment={};
    for(const [key,label] of [['appVersion','App'],['osSystem','iOS'],['platform','机型'],['sdkVersion','SDK'],['analyticsEnvironment','埋点环境'],['plistRunEnvironment','运行环境']]){const v=value(key);if(v)e.environment[label]=v;}
  }
  const events = []; let current = null, line = 0, unmatched = 0, invalidHeaders = 0, blankLines = 0;
  const header = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\]\s*\[([^\]]*)\]\s*\[(.*?)\](?:\s+(.*))?$/;
  function push() {
    if (!current) return;
    if(++eventCount>250000)throw new Error('单文件超过 250,000 条事件');
    if(!Number.isFinite(current.stamp))throw new Error('日志时间无效');
    const e = current, text = e.message;
    e.requestId = (text.match(/(?:["']?requestId["']?\s*[:=]\s*["']?)([\w-]+)/i) || [])[1] || '';
    e.api=(text.match(/\bapi\s*[:=]\s*([\w.-]+)/)||[])[1]||'';
    e.direction = /\brequest:/.test(text) ? 'request' : /\bresponse:/.test(text) ? 'response' : '';
    readNetworkTarget(e);
    e.kind = e.direction ? 'request' : /LTRTC|IPC|拉流|推流|停流|DataChannel|PlaybackActor|ICE restart|no_answer/i.test(e.location + text) ? 'stream' : /BLE|BTManager|bluetooth|配网|蓝牙|连接设备|断开.*设备|MeariProvision/i.test(e.location + text) ? 'device' : /didBecomeActive|willResignActive|didEnterBackground|willEnterForeground|BackgroundKillMonitor|launch 开始/.test(text) ? 'lifecycle' : /RNFull|RNOta|RNReach|RNBundle/.test(e.location + text) ? 'rn' : 'other';
    business(e); classifyAnomaly(e,anomalyMode); events.push(e); current = null;
  }
  return { line(s) {
    line++; const m=s.match(header);
    if(m){
      push();const time=m[1].includes('.')?m[1].replace(/\.(\d+)$/,(_,digits)=>'.'+digits.padEnd(3,'0')):m[1]+'.000';
      const stamp=Date.parse(time.replace(' ','T')+'Z');
      if(!Number.isFinite(stamp)||new Date(stamp).toISOString().replace('T',' ').slice(0,23)!==time){unmatched++;invalidHeaders++;return;}
      const token=m[2].trim().match(/^(DEBUG|INFO|WARNING|WARN|ERROR|[DIWE])(?=$|[^A-Za-z])/i)?.[1].toUpperCase();
      const level=token?token[0]:'OTHER';
      current={file,line,endLine:line,time,stamp,level,rawLevel:m[2],location:m[3],module:m[3].split(':')[0]||(m[3].match(/\[([^ ]+)/)||[])[1]||'SDK',message:m[4]||'',raw:s};
    }else if(/^\[\d{4}-\d{2}-\d{2}/.test(s)){push();unmatched++;invalidHeaders++;}
    else if(current){current.raw+='\n'+s;current.message+='\n'+s;current.endLine=line;}
    else if(s.trim())unmatched++;else blankLines++;
  }, finish(){push();return {events,unmatched,invalidHeaders,blankLines};} };
}
function correlate(events) {
 const buckets=new Map();let pairs=0,sum=0;
 events.sort((a,b)=>a.stamp-b.stamp||a.file.localeCompare(b.file)||a.line-b.line);
 events.forEach((e,i)=>{
  e.id=i;delete e.partner;delete e.duration;delete e.pairStatus;
  if(!e.direction)return;
  e.pairStatus='unmatched';if(!e.requestId)return;
  const scope=e.sessionId?`${e.file.includes('/')?e.file.slice(0,e.file.lastIndexOf('/')):''}|${e.sessionId}`:e.file;
  const key=JSON.stringify([scope,Boolean(e.cozyRequest),e.requestId.toLowerCase(),e.api.toLowerCase()||'']);
  if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(e);
 });
 for(const group of buckets.values()){
  const requests=group.filter(e=>e.direction==='request'),responses=group.filter(e=>e.direction==='response');
  if(requests.length>1||responses.length>1){for(const e of group)e.pairStatus='ambiguous';continue;}
  if(requests.length===1&&responses.length===1){const a=requests[0],b=responses[0],ms=b.stamp-a.stamp;
   if(ms<0){a.pairStatus=b.pairStatus='ambiguous';continue;}
   a.partner=b.id;b.partner=a.id;a.duration=b.duration=ms;a.pairStatus=b.pairStatus='paired';a.pairBasis=b.pairBasis='requestId';pairs++;sum+=ms;
  }
 }
 // Many SDK request records omit requestId while the corresponding response logs it.
 // Keep the association explicit as a time/API inference instead of discarding it.
 const fallback=new Map();
 for(const e of events){if(!e.direction||e.pairStatus!=='unmatched'||!e.api)continue;const key=JSON.stringify([e.file,Boolean(e.cozyRequest),e.api.toLowerCase()]);if(!fallback.has(key))fallback.set(key,[]);fallback.get(key).push(e);}
 for(const group of fallback.values()){
  const requests=group.filter(e=>e.direction==='request').sort((a,b)=>a.stamp-b.stamp||a.line-b.line),responses=group.filter(e=>e.direction==='response').sort((a,b)=>a.stamp-b.stamp||a.line-b.line),used=new Set();
  for(const response of responses){
   if(response.pairStatus!=='unmatched')continue;
   const candidates=requests.filter(request=>!used.has(request.id)&&request.pairStatus==='unmatched'&&request.stamp<=response.stamp&&response.stamp-request.stamp<=30000&&(request.requestId===''||response.requestId===''||request.requestId.toLowerCase()===response.requestId.toLowerCase()));
   if(!candidates.length)continue;
   const request=candidates.at(-1),ms=response.stamp-request.stamp,basis=request.requestId&&response.requestId?'requestId_scope_fallback':'api_time_fallback';used.add(request.id);request.partner=response.id;response.partner=request.id;request.duration=response.duration=ms;request.pairStatus=response.pairStatus='paired';request.pairBasis=response.pairBasis=basis;pairs++;sum+=ms;
  }
 }
 return {pairs,average:pairs?Math.round(sum/pairs):null,ambiguous:events.filter(e=>e.pairStatus==='ambiguous').length,unmatched:events.filter(e=>e.pairStatus==='unmatched').length};
}
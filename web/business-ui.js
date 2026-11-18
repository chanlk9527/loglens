const businessNames={provision:'觅睿配网',bluetooth:'蓝牙连接',mqtt:'MQTT 通信',pump:'吸奶器状态',rn:'RN / OTA',auth:'登录与验证码',stream:'推拉流','':'未识别业务'};
const stageNames={sdk_login:'SDK 登录',origin_device_list:'原设备列表',ble_scan:'蓝牙扫描',stop_scan:'停止扫描',clear_timer:'清理定时器',sdk_event:'SDK 事件',cloud_device_list_timer:'云设备列表定时器',scan_start:'开始扫描',scan_stop:'停止扫描',connect:'发起连接',disconnect:'断开设备',disconnect_all:'断开全部',bluetooth_event:'蓝牙事件',central_created:'蓝牙管理器创建',connected:'连接成功',subscribe_ack:'订阅回执',subscribe:'订阅',reconnect:'重连',reconnect_skipped:'跳过重连',disconnected:'断开连接',transport:'传输事件',js_loaded:'JS 加载完成',assets_failed:'资源注册失败',version_reach:'资源版本生效',gate_denied:'策略跳过',prepare:'准备加载',ota_event:'OTA 事件',email_code:'邮箱验证码',captcha_config:'验证码配置',token_create:'获取令牌',login:'登录',activity:'实时活动',session_create:'流会话创建',session_init:'流会话初始化',session_release:'流会话释放',pull_start:'开始拉流',pull_stop:'停止拉流',push_start:'开始推流',push_stop:'停止推流',data_channel:'数据通道',ice_restart:'ICE 重启',connect_error:'流连接失败',playback_config:'播放配置',stream_event:'流事件'};
const outcomeNames={success:'成功',fail:'失败',start:'开始',candidate:'疑似异常',skipped:'跳过'};
let businessCategory='provision',businessPage=0;
function renderBusiness(){
 const tabs=$('businessTabs');tabs.replaceChildren();
 for(const [key,name] of Object.entries(businessNames)){const button=document.createElement('button');const n=filtered.filter(e=>e.business?.category===key).length;button.textContent=`${name} ${n.toLocaleString()}`;button.className=key===businessCategory?'selected':'';button.setAttribute('aria-pressed',key===businessCategory);button.onclick=()=>{businessCategory=key;businessPage=0;renderBusiness();};tabs.append(button);}
 const outcome=$('businessOutcome').value,device=$('businessDevice').value.toLowerCase();
 const items=filtered.filter(e=>e.business?.category===businessCategory&&(!outcome||e.business.outcome===outcome)&&(!device||e.business.device.toLowerCase().includes(device)));
 const summary=$('businessSummary');summary.replaceChildren();
 const countField=(label,entries)=>{const block=document.createElement('div');const title=document.createElement('span');title.textContent=label;block.append(title);if(!entries.length){const empty=document.createElement('b');empty.textContent='—';block.append(empty);}for(const [value,count] of entries){const row=document.createElement('div');row.className='summaryvalue';row.textContent=`${value} · ${count}`;block.append(row);}summary.append(block);};
 const tally=arr=>{const counts=new Map();for(const v of arr)if(v)counts.set(v,(counts.get(v)||0)+1);return [...counts].sort((a,b)=>b[1]-a[1]).slice(0,4);};
 countField('阶段记录',tally(items.map(e=>stageNames[e.business.stage]||e.business.stage)));
 countField('诊断码',tally(items.map(e=>e.business.fields['诊断码'])));
 countField('记录结果',tally(items.map(e=>outcomeNames[e.business.outcome]||'未标记')));
 const env=$('environment');env.replaceChildren();const vals=new Map();for(const e of filtered)for(const [key,v]of Object.entries(e.environment||{})){if(!vals.has(key))vals.set(key,new Set());vals.get(key).add(v);}for(const [key,values]of vals){const chip=document.createElement('span');chip.textContent=key+' '+[...values].join(' / ');env.append(chip);}
 const pages=Math.ceil(items.length/40);businessPage=Math.max(0,Math.min(businessPage,pages-1));const body=$('businessRows');body.replaceChildren();
 for(const e of items.slice(businessPage*40,(businessPage+1)*40)){const b=e.business,tr=document.createElement('tr');tr.tabIndex=0;tr.dataset.id=e.id;tr.className='logRow level-'+logLevelKey(e.level);tr.onclick=()=>openDetail(e.id);tr.onkeydown=k=>{if(k.key==='Enter')openDetail(e.id);};const details=Object.entries(b.fields).filter(([k])=>!['设备','阶段','requestId'].includes(k)).map(([k,v])=>k+': '+v).join(' · ');const fields=[e.time,e.level,stageNames[b.stage]||b.stage,outcomeNames[b.outcome]||'—',b.device||'—',details||e.message.split('\n')[0]];fields.forEach((v,i)=>{const td=document.createElement('td');if(i===1)td.append(logLevelBadge(e.level));else td.textContent=v;td.title=v;if(i===3)td.className=['fail','candidate'].includes(b.outcome)?'businessbad':'';tr.append(td);});body.append(tr);}
 if(!items.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.className='empty';td.textContent='暂无匹配记录';tr.append(td);body.append(tr);}
 $('businessPage').textContent=`${pages?businessPage+1:0} / ${pages} · ${items.length.toLocaleString()} 条`;$('businessPrev').disabled=businessPage===0;$('businessNext').disabled=businessPage>=pages-1;
}
function showBusinessFields(e){const box=$('businessFields');box.replaceChildren();if(!e.business?.category)return;const b=e.business;const data={'业务':businessNames[b.category],'识别依据':b.basis||'未记录','操作':stageNames[b.stage]||b.stage,'结果':outcomeNames[b.outcome]||'未标记',...b.fields};for(const [key,value]of Object.entries(data)){const row=document.createElement('div'),label=document.createElement('span'),v=document.createElement('strong');label.textContent=key;v.textContent=value;row.append(label,v);box.append(row);}}
$('businessOutcome').onchange=()=>{businessPage=0;renderBusiness();};$('businessDevice').oninput=()=>{businessPage=0;renderBusiness();};$('businessPrev').onclick=()=>{businessPage--;renderBusiness();};$('businessNext').onclick=()=>{businessPage++;renderBusiness();};renderBusiness();
const businessDemo=`
[2026-11-17 11:38:01.000] [I📝] [MeariProvisionModule:70 startScan()] 【觅睿】阶段=sdk_login，结果=success
[2026-11-17 11:38:02.000] [I📝] [MeariProvisionModule:79 startScan()] 【觅睿】阶段=origin_device_list，结果=success，device_count:0
[2026-11-17 11:38:03.000] [I📝] [MeariProvisionModule:81 startScan()] 【觅睿】阶段=ble_scan，结果=start
[2026-11-17 11:38:24.000] [D🛠] [BTManager:586 disconnectEntity(_:)] 断开设备连接：Optional("DEMO-DEVICE")
[2026-11-17 11:38:25.000] [D🛠] [PumpFloatingManager:308 consumeM5ProPresentationOutput(_:)] PumpActivity action：FloatingManager.consumeOutput reason=app.willResignActive devices=0 active=false running=false elapsed=nil tracked=[]
[2026-11-17 11:39:01.000] [I📝] [LTRNOtaVersionReachReporter:54 reportIfNeeded()] [RNReach] rn_ota_version_reach resId=full ver=3.4.0 size=63765638 ms=2589 sticky=false
[2026-11-17 11:40:01.000] [I] [MeariProvisionModule:70 startScan()] 【觅睿】阶段=sdk_login，结果=success operationId=DEMO-OP-A device_id=DEMO-DEVICE-A
[2026-11-17 11:40:02.000] [I] [MeariProvisionModule:81 startScan()] 【觅睿】阶段=ble_scan，结果=start operationId=DEMO-OP-A device_id=DEMO-DEVICE-A
[2026-11-17 11:40:12.000] [E] [MeariProvisionModule:164 reportScanFailure()] 【觅睿】阶段=ble_scan，结果=fail operationId=DEMO-OP-A device_id=DEMO-DEVICE-A diagnostic_code=DEMO_SCAN_TIMEOUT
[2026-11-17 11:40:20.000] [I] [MeariProvisionModule:90 scanResult()] 【觅睿】阶段=ble_scan，结果=success operationId=DEMO-OP-A device_id=DEMO-DEVICE-A
[2026-11-17 11:41:01.000] [I] [MeariProvisionModule:70 startScan()] 【觅睿】阶段=sdk_login，结果=success operationId=DEMO-OP-B device_id=DEMO-DEVICE-B
[2026-11-17 11:41:02.000] [I] [MeariProvisionModule:81 startScan()] 【觅睿】阶段=ble_scan，结果=start operationId=DEMO-OP-B device_id=DEMO-DEVICE-B
[2026-11-17 11:41:05.000] [I] [MeariProvisionModule:90 scanResult()] 【觅睿】阶段=ble_scan，结果=success operationId=DEMO-OP-B device_id=DEMO-DEVICE-B
`;
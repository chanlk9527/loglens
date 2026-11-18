$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
$sources = @{}
foreach ($name in @('parser.js','import.js','app.js','business-ui.js','issue-model.js','analysis.js','insights.js','focus.js','request-dashboard.js','workflows.js','navigation.js','desktop-ui.js','index.html','LogLens.html','analysis-tests.js','parser-tests.js')) {
    $path = Join-Path $PSScriptRoot $name
    try { $sources[$name] = [System.IO.File]::ReadAllText($path, $utf8) }
    catch {
        $lines = & rg -a --no-line-number '^' $path
        if ($LASTEXITCODE -ne 0) { throw "Cannot read $name" }
        $sources[$name] = $lines -join "`n"
    }
}
$runner = @'
const vm=require('node:vm'),assert=require('node:assert/strict');
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',async()=>{
const src=JSON.parse(input),elements=new Map();
function element(){return {value:'',textContent:'',children:[],dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x},setAttribute(name,value){this[name]=value;},focus(){this.focused=true;},addEventListener(){},querySelectorAll(){return []},add(){},showModal(){this.open=true},close(){this.open=false}};}
for(const match of src['index.html'].matchAll(/id="([^"]+)"/g)){assert(!elements.has(match[1]),'duplicate DOM id');elements.set(match[1],element());}
function makeZip(name,text,method){
 const zlib=require('node:zlib'),raw=Buffer.from(text),body=method===8?zlib.deflateRawSync(raw):raw,filename=Buffer.from(name);
 const crc=zlib.crc32(raw),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26);
 central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,6);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(filename.length,28);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+filename.length,12);end.writeUInt32LE(30+filename.length+body.length,16);
 return Buffer.concat([local,filename,body,central,filename,end]);
}
const ctx=vm.createContext({console,setTimeout,clearTimeout,Blob,URL,File,TextDecoder,TextEncoder,ReadableStream,DecompressionStream,makeZip,Option:function(){},document:{getElementById(id){assert(elements.has(id),'missing DOM id '+id);return elements.get(id)},createElement:element}});
for(const name of ['parser.js','import.js','app.js','business-ui.js','issue-model.js','analysis.js','insights.js','focus.js','request-dashboard.js','workflows.js','navigation.js','desktop-ui.js'])vm.runInContext(src[name],ctx,{filename:name});
function assertBusinessChrome(elements,empty=false){
 const collect=e=>String(e.textContent||'')+(e.children||[]).map(collect).join(' ');
 for(const id of ['businessTabs','businessSummary','businessPage'])assert.doesNotMatch(collect(elements.get(id)),/\[2026-|operationId=|MeariProvisionModule/,'sample log leaked into '+id);
 if(empty){
  assert.deepEqual(elements.get('businessTabs').children.map(e=>e.textContent),['觅睿配网 0','蓝牙连接 0','MQTT 通信 0','吸奶器状态 0','RN / OTA 0','登录与验证码 0','推拉流 0','未识别业务 0']);
  assert.equal(elements.get('businessPage').textContent,'0 / 0 · 0 条');
  assert.equal(collect(elements.get('businessRows')),'暂无匹配记录');
 }
}
assertBusinessChrome(elements,true);
vm.runInContext(String.raw`
if(!$('focusResults').hidden)throw Error('empty landing should hide results');
const parser=createParser('synthetic.log');
for(const line of businessDemo.trim().split('\n'))parser.line(line);
events=parser.finish().events;correlate(events);filtered=events;
reportFiles([{name:'synthetic.log',status:'6 条事件，0 行无时间头内容未归属'},{name:'sdk.xlog',status:'跳过：暂不支持此格式'}]);
renderBusiness();

`,ctx);
assertBusinessChrome(elements);
assert.match(elements.get('coverage').textContent,/收到 2 个文件/);
assert.match(elements.get('coverage').textContent,/不支持 1 个/);
vm.runInContext(String.raw`
const candidate={id:80,time:'2026-11-17 11:38:00.000',file:'synthetic.log',stamp:1794915480000,line:1,endLine:1,module:'Test',message:'failure elapsedMs=12345',issue:true,business:{category:'provision',stage:'scan',device:'device-A',fields:{}}};
filtered=[candidate,{...candidate,id:81,message:'failure elapsedMs=99999'},{...candidate,id:82,module:'Different'}];
if(groupIssues(filtered).length!==2)throw Error('group separation');
let exported;downloadAnalysis=(name,payload)=>{exported=payload};
$('businessDevice').value='device-A';$('businessOutcome').value='fail';
$('exportBusiness').onclick();if(exported.events.length!==0)throw Error('business outcome scope');
$('businessOutcome').value='';$('exportBusiness').onclick();if(exported.events.length!==3)throw Error('business scope');
$('businessDevice').value='missing';$('exportBusiness').onclick();if(exported.events.length!==0)throw Error('device scope');
$('exportReport').onclick();if(exported.includes('device-A')||exported.includes('failure 12345'))throw Error('report raw data leak');
$('problemTime').value='2026-11-17T11:38:00';$('timeRadius').value='5';$('search').value='missing';$('locateTime').onclick();
if($('search').value!==''||timeWindow[1]-timeWindow[0]!==600000||!filtered.length)throw Error('time location');
`,ctx);
assert.equal(elements.get('panel-summary').hidden,false,'overview visible by default');
assert.equal(elements.get('panel-issues').hidden,true,'issues hidden by default');
const embedded=[...src['LogLens.html'].matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');new vm.Script(embedded);
for(const name of ['parser.js','import.js','app.js','business-ui.js','issue-model.js','analysis.js','insights.js','focus.js','request-dashboard.js','workflows.js','navigation.js','desktop-ui.js'])assert(embedded.includes(src[name].trim()),'stale bundle '+name);
const reloadElements=new Map([...elements.keys()].map(id=>[id,element()]));
const reloadCtx=vm.createContext({console,setTimeout,clearTimeout,Blob,URL,File,TextDecoder,TextEncoder,ReadableStream,DecompressionStream,Option:function(){},document:{getElementById:id=>reloadElements.get(id),createElement:element}});
vm.runInContext(embedded,reloadCtx);
assert.equal(vm.runInContext('events.length',reloadCtx),0,'fresh page has no imported events');
assertBusinessChrome(reloadElements,true);
console.log('PASS: clean business labels and pagination before/after demo; fresh bundled page contains zero imported events.');
const workerSource=vm.runInContext("[classifyAnomaly.toString(),createParser.toString(),correlate.toString(),unpackZip.toString(),decodeInputs.toString(),'('+workerMain.toString()+')()'].join(String.fromCharCode(10))",ctx);
const workerMessages=[];
const workerCtx=vm.createContext({Blob,File,TextDecoder,TextEncoder,ReadableStream,DecompressionStream,self:{postMessage:x=>workerMessages.push(x)}});
vm.runInContext(workerSource,workerCtx);
await workerCtx.self.onmessage({data:[new File(['[2026-11-17 12:00:00.000] [I] [Demo:1 scan] success'],'worker.log')]});
assert.equal(workerMessages.at(-1).type,'done');assert.equal(workerMessages.at(-1).events.length,1);
await vm.runInContext(src['analysis-tests.js'],ctx,{filename:'analysis-tests.js'});
await vm.runInContext(src['parser-tests.js'],ctx,{filename:'parser-tests.js'});
console.log('PASS: script initialization, DOM IDs, coverage, issue grouping, export scope, summary omission, time location, bundle parity.');
});
'@
$sources | ConvertTo-Json -Compress | & node -e $runner
if ($LASTEXITCODE -ne 0) { throw 'Verification failed' }

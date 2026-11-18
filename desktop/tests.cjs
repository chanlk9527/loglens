'use strict';
const assert=require('node:assert/strict');
const {createStore}=require('./store.cjs');
const {runAgent,createSession,stateFor}=require('./agent.cjs');
const base={stamp:1000,time:'2026-11-18 12:00:00',file:'user-logs/app.log',line:1,endLine:1,module:'Provision',level:'I',business:{category:'provision',stage:'scan',device:'DEVICE-1234'},operationId:'OPERATION-1234',message:'scan failed token=SECRET user@example.com'};
const store=createStore({events:[{...base,id:0},{...base,id:1,stamp:1100,message:'scan success'},{...base,id:2,file:'another-user/app.log',message:'scan success'}],reports:[{name:base.file,status:'3 条事件'}]});
const config={endpoint:'https://example.invalid/v1/chat/completions',model:'synthetic',apiKey:'secret'};
const response=(action)=>new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:20},choices:[{finish_reason:'stop',message:{content:JSON.stringify(action)}}]}));
const diagnosis={status:'hypothesis',summary:'扫描失败后出现同阶段成功，根因未知。',observations:[{text:'扫描失败。',evidenceIds:['E0']}],hypotheses:[{text:'可能是暂时条件不满足。',evidenceIds:['E0'],counterEvidenceIds:['E1'],missingEvidence:['设备侧记录。']}],limitations:['客户端片段不能确定根因。'],nextChecks:['补充设备日志。']};
const run=(options)=>runAgent({store,question:'为什么失败？',config,signal:new AbortController().signal,...options});
assert.equal(store.query('search',{any:['failed','timeout'],exclude:['success']}).total,1);
assert.equal(store.query('search',{all:['scan','success'],order:'desc',limit:1}).evidence[0].id,'E1');
assert.equal(store.query('related',{id:'E0',mode:'operation'}).total,2);
assert.equal(store.query('context',{id:'E0'}).total,2);
assert.equal(store.query('aggregate',{groupBy:'outcome'}).matchedEvents,3);
assert.equal(store.query('compare',{leftId:'E0',rightId:'E2',mode:'operation'}).left.total,2);
assert.equal(store.query('compare',{leftId:'E0',rightId:'E2',mode:'operation'}).right.total,1);
for(const [name,args]of [['shell',{}],['read',{id:'E999'}],['search',{offset:-1}],['search',{any:'bad'}],['search',{limit:100}],['search',{start:2,end:1}],['aggregate',{groupBy:'raw'}]])assert.throws(()=>store.query(name,args));
assert.throws(()=>createStore({events:[{...base,id:0},{...base,id:0}],reports:[]}));
const evidence=store.query('search',{query:'failed'}).evidence[0];
for(const secret of ['DEVICE-1234','OPERATION-1234','SECRET','user@example.com','user-logs'])assert(!evidence.text.includes(secret),secret);
const many=createStore({events:Array.from({length:60},(_,id)=>({...base,id})),reports:[]});
assert.equal(many.query('search',{}).truncated,true);
assert.equal(many.query('search',{offset:56}).evidence.length,4);
(async()=>{
 const session=createSession(store);let calls=0;
 const first=await run({session,fetchImpl:async(_url,options)=>{
  const state=JSON.parse(JSON.parse(options.body).messages[1].content);
  assert(Buffer.byteLength(JSON.stringify(state))<=72000);assert(!options.body.includes('SECRET'));
  return response([
   {tool:'search',args:{query:'failed'}},
   {notes:{facts:[{text:'观察到失败',evidenceIds:['E0']}],hypotheses:[],openQuestions:['是哪一次操作？'],pinIds:['E0']}},
   {ask:{question:'你说的是哪一次操作？',options:['第一次','第二次']}}
  ][calls++]);
 }});
 assert.equal(first.kind,'needs_input');assert.equal(session.calls,3);assert.equal(session.notes.facts.length,1);
 let secondCalls=0;
 const second=await run({session,question:'第一次，之后重试成功了。',fetchImpl:async(_url,options)=>{
  const state=JSON.parse(JSON.parse(options.body).messages[1].content);
  assert(state.conversation.some(x=>x.text.includes('第一次，之后')));assert.equal(state.notes.facts[0].evidenceIds[0],'E0');
  return response(secondCalls++===0?{tool:'related',args:{id:'E0',mode:'operation'}}:{diagnosis});
 }});
 assert.equal(second.kind,'complete');assert.deepEqual(second.diagnosis,diagnosis);assert.equal(session.calls,5);assert.equal(second.usage.inputTokens,500);
 // Repeating a query is allowed; it provides a notice rather than throwing away the investigation.
 let repeated=0;
 const repeat=await run({fetchImpl:async(_url,options)=>{
  const state=JSON.parse(JSON.parse(options.body).messages[1].content);
  if(repeated===2)assert.match(state.lastTool.notice,/先前/);
  return response(repeated++<2?{tool:'search',args:{query:''}}:{diagnosis});
 }});
 assert.equal(repeat.kind,'complete');assert.equal(repeated,3);
 // Invalid evidence is returned to the model to repair, never published.
 let repair=0;
 const repaired=await run({fetchImpl:async(_url,options)=>{
  const state=JSON.parse(JSON.parse(options.body).messages[1].content);
  if(repair===1)assert(state.lastTool.error);
  return response([ {diagnosis},{tool:'search',args:{query:''}},{diagnosis} ][repair++]);
 }});
 assert.equal(repaired.kind,'complete');
 const persistent=createSession(store);
 const paused=await run({session:persistent,maxRounds:1,fetchImpl:async()=>response({tool:'search',args:{query:''}})});
 assert.equal(paused.kind,'paused');assert(persistent.evidence.has('E0'));
 const resumed=await run({session:persistent,question:'继续',fetchImpl:async()=>response({diagnosis})});assert.equal(resumed.kind,'complete');
 const isolated=createSession(many);await assert.rejects(()=>run({session:isolated}),/数据集/);
 const cancel=new AbortController();
 const cancelled=await run({session:persistent,signal:cancel.signal,fetchImpl:async()=>{cancel.abort();throw Error('aborted');}});
 assert.equal(cancelled.kind,'paused');assert(persistent.evidence.has('E0'));
 const network=await run({fetchImpl:async()=>new Response('API SECRET',{status:401})});assert.equal(network.kind,'paused');assert(!network.message.includes('API SECRET'));
 // Pinning survives context eviction; past answers are not promoted to evidence.
 const bounded=createSession(many);
 for(let i=0;i<60;i++)bounded.evidence.set('E'+i,{id:'E'+i,text:'中'.repeat(1000)});
 bounded.notes.pinIds=['E0'];
 const state=stateFor(bounded,many,10);assert(state.evidence.some(x=>x.id==='E0'));assert(Buffer.byteLength(JSON.stringify(state))<=72000);assert(bounded.evidence.size<60);
 const noLeak=await run({question:'邮箱 user@example.com token=SECRET',maxRounds:1,fetchImpl:async(_url,options)=>{assert(!options.body.includes('user@example.com'));assert(!options.body.includes('SECRET'));return response({ask:{question:'何时发生？',options:[]}});}});assert.equal(noLeak.kind,'needs_input');
 // Requests must use only the user cancellation signal; application timers are forbidden.
 const originalTimeout=AbortSignal.timeout;
 AbortSignal.timeout=()=>{throw Error('Unexpected application deadline');};
 try{
  const userControl=new AbortController();
  const waiting=await run({signal:userControl.signal,fetchImpl:async(_url,options)=>{
   assert.equal(options.signal,userControl.signal);
   await new Promise(resolve=>setTimeout(resolve,25));
   assert.equal(options.signal.aborted,false);
   return response({ask:{question:'请补充时间',options:[]}});
  }});
  assert.equal(waiting.kind,'needs_input');
  const stopControl=new AbortController();
  const stopped=await run({signal:stopControl.signal,fetchImpl:async(_url,options)=>new Promise((_resolve,reject)=>{
   options.signal.addEventListener('abort',()=>reject(Error('User cancelled')),{once:true});
   setImmediate(()=>stopControl.abort());
  })});
  assert.equal(stopped.kind,'paused');assert.match(stopped.message,/停止/);
 }finally{AbortSignal.timeout=originalTimeout;}
 console.log('PASS: combined search, aggregate, compare, source isolation, redaction, autonomous tool selection, ask/resume, notes/pinning, repair, repeat queries, budget resume, cancellation, dataset isolation and context bounds.');
})().catch(error=>{console.error(error);process.exitCode=1;});

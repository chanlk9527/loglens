'use strict';
const vm=require('node:vm'),assert=require('node:assert/strict');
async function verify(source){
 const elements=new Map(),listeners=new Map();
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.value='';this._text='';this.disabled=false;}
  set id(v){this._id=v;elements.set(v,this);}get id(){return this._id;}
  set textContent(v){this._text=v;}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  append(...items){this.children.push(...items);if(this.tag==='select'&&!this.value)this.value=items[0]?.value;}
  replaceChildren(...items){this.children=items;}setAttribute(){}focus(){this.focused=true;}
 }
 const panel=new Element('div');panel.id='panel-ai';const footer=new Element('p');
 let resolveDiagnosis,request,imports=0,cancelled=0,opened;
 const bridge={configure:async()=>{},importDataset:async()=>{imports++;return {datasetId:'D1'};},diagnose:async data=>{request=data;return new Promise(r=>resolveDiagnosis=r);},cancel:async()=>{cancelled++;},onProgress:fn=>{bridge.progress=fn;}};
 const ctx=vm.createContext({setInterval,clearInterval,window:{loglensDesktop:bridge,addEventListener:(name,fn)=>listeners.set(name,fn)},document:{createElement:tag=>new Element(tag),querySelector:()=>footer},$:id=>elements.get(id),events:[{id:0,message:'synthetic'}],importReports:[],busy:false,openDetail:id=>opened=id});
 vm.runInContext(source,ctx);
 const all=()=>{const result=[];function walk(e){result.push(e);e.children.forEach(walk);}walk(panel);return result;};
 const button=text=>all().find(e=>e.tag==='button'&&e.textContent===text);
 const tick=()=>new Promise(r=>setImmediate(r));
 const notes={facts:[{text:'Observed',evidenceIds:['E0']}],hypotheses:[],openQuestions:[],pinIds:['E0']};
 const envelope={datasetId:'D1',notes,calls:1,usage:{inputTokens:100,outputTokens:10}};
 elements.get('aiQuestion').value='发生了什么？';const first=elements.get('aiStart').onclick();await tick();
 assert.equal(request.newSession,true);assert.equal(request.mode,'quick');
 assert.equal(elements.get('aiConversation').children[1].className,'aiRun isRunning','AI run appears immediately below the user message');
 const firstRun=elements.get('aiConversation').children[1];
 assert(firstRun.children.some(e=>e.className==='aiRunLatest'),'live status is directly visible, outside details');
 bridge.progress({datasetId:'D1',message:'执行 search：返回 20 条证据'});
 assert(firstRun.children.some(e=>e.className==='aiRunLatest'&&e.textContent.includes('搜索日志')));
 bridge.progress({datasetId:'D1',message:'已更新调查笔记',notes});
 const visibleNotes=firstRun.children.find(e=>e.className==='aiRunNotes');
 assert.equal(visibleNotes.open,true);assert.equal(visibleNotes.hidden,false);
 bridge.progress({datasetId:'old',message:'不应显示'});assert(!firstRun.textContent.includes('不应显示'));
 resolveDiagnosis({...envelope,kind:'needs_input',ask:{question:'哪一次？',options:['第一次']}});await first;
 assert.match(elements.get('aiConversation').textContent,/哪一次/);button('第一次').onclick();assert.equal(elements.get('aiQuestion').value,'第一次');
 const second=elements.get('aiStart').onclick();await tick();assert.equal(request.newSession,false);assert.equal(imports,1);assert(elements.get('aiConversation').children.includes(firstRun),'previous investigation remains in conversation');assert.equal(firstRun.className,'aiRun waiting');
 resolveDiagnosis({...envelope,kind:'complete',diagnosis:{status:'insufficient_evidence',summary:'尚不能确定',observations:[{text:'记录存在',evidenceIds:['E0']}],hypotheses:[],limitations:['覆盖不足'],nextChecks:['补充日志']}});await second;
 assert.match(elements.get('aiResult').textContent,/尚不能确定/);button('E0').onclick();assert.equal(opened,0);
 const third=button('继续调查').onclick();await tick();button('停止').onclick();assert.equal(cancelled,1);
 resolveDiagnosis({...envelope,kind:'paused',message:'已停止，保留状态'});await third;assert.match(elements.get('aiResult').textContent,/尚不能确定/);
 button('新建调查').onclick();assert.equal(elements.get('aiConversation').textContent,'');
 elements.get('aiQuestion').value='另一个问题';const fourth=elements.get('aiStart').onclick();await tick();assert.equal(request.newSession,true);
 listeners.get('loglens-import-start')();resolveDiagnosis({...envelope,kind:'paused',message:'旧数据'});await fourth;
 assert.equal(elements.get('aiResult').textContent,'');assert.equal(button('继续调查').disabled,true);
 console.log('PASS: desktop conversation ask/reply, session reuse, evidence navigation, cancellation preserves report, new investigation and stale-result isolation.');
}
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>verify(input).catch(error=>{console.error(error);process.exitCode=1;}));

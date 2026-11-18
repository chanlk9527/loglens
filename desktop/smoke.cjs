'use strict';
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
module.exports=async function smoke(win,outputDir){
 let calls=0;
 const provider=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const state=JSON.parse(JSON.parse(raw).messages[1].content);calls++;
  const action=calls===1?{tool:'search',args:{query:''}}:calls===2?{tool:'context',args:{id:state.evidence[0].id,radiusMs:300000}}:{diagnosis:{status:'insufficient_evidence',summary:'已查看相关客户端记录，当前证据不足以断定根因。',observations:[{text:'在本次数据集中观察到相关记录，需结合具体问题时间核对。',evidenceIds:[state.evidence[0].id]}],hypotheses:[],limitations:['这是本地模拟模型的界面验收，不是真实诊断。'],nextChecks:['补充问题发生时间和相关设备。']}};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(action)}}]}));
 });
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 const js=code=>win.webContents.executeJavaScript(code);
 const until=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,100));}throw Error('Desktop smoke timed out: '+code);};
 try{
  const state=await js("({bridge:!!window.loglensDesktop,title:document.title,ai:!!document.getElementById('desktopDiagnosis')})");
  if(!state.bridge||!state.ai)throw Error('Desktop bridge/UI missing');
  await js("document.getElementById('demo').click()");
  await until('events.length>0&&!busy');
  await js(`window.loglensDesktop.configure({baseUrl:'http://127.0.0.1:${provider.address().port}/v1',model:'smoke-model',apiKey:'synthetic-only'})`);
  await js("document.getElementById('tab-ai').click();document.getElementById('aiQuestion').value='添加设备失败，能否定位？';document.getElementById('aiStart').click()");
  await until("document.getElementById('aiResult').textContent.length>0");
  await js("document.getElementById('desktopDiagnosis').scrollIntoView()");
  await new Promise(resolve=>setTimeout(resolve,700));
  await fs.writeFile(path.join(outputDir,'smoke.png'),(await win.webContents.capturePage()).toPNG());
  await js("document.querySelector('#aiResult button').click()");
  if(!await js("document.getElementById('detail').open"))throw Error('Evidence did not open original log');
  if(calls!==3)throw Error('Expected multi-round investigation');
  console.log('DESKTOP_SMOKE_PASS '+JSON.stringify({...state,modelCalls:calls,evidenceNavigation:true}));
 }finally{await new Promise(resolve=>{provider.close(resolve);provider.closeAllConnections();});}
};

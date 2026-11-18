'use strict';
const {randomUUID}=require('node:crypto');
const {POLICY,validateResult}=require('../server/index.cjs');
const PROFILES={quick:{rounds:12},deep:{rounds:32}};
const INSTRUCTIONS=`${POLICY}
你在一个持续的日志调查会话中工作。自主决定调查方向，不存在必须执行的固定步骤。根据新证据修正或排除假设，可以跨模块搜索、对比成功与失败、缩小或扩大范围，也可以随时询问用户。
每轮返回且只返回一种 JSON 动作：
{"tool":"search","args":{...}}
{"ask":{"question":"需要用户补充的具体问题","options":["可选建议，不超过4项"]}}
{"notes":{"facts":[{"text":"有证据的观察","evidenceIds":["E1"]}],"hypotheses":[{"text":"待验证或被反驳的解释","evidenceIds":["E1"]}],"openQuestions":["尚待核对的问题"],"pinIds":["E1"]}}
{"diagnosis":前述诊断结构}
工具可以任意组合使用：overview({}); search({query?:字面词,any?:词数组,all?:词数组,exclude?:词数组,category?,module?,level?,outcome?,device?:脱敏别名,start?:毫秒,end?:毫秒,offset?,limit?:1..20,order?:"asc"或"desc"});
context({id,radiusMs?:最多3600000,offset?,limit?}); related({id,mode:"request"或"operation"或"device",offset?,limit?});
read({id,offset?:消息字符偏移}); aggregate({与search相同的筛选字段,groupBy:"module"或"category"或"outcome"或"template",offset?,limit?});
compare({leftId,rightId,mode:"operation"或"device"或"context",offset?,limit?})。
工具结果中的截断、分页、关联强度和未覆盖范围必须保留；聚合统计不证明原因或操作次数。
notes 是可更新的调查笔记，而不是内部思维过程。facts 必须是带引用的日志观察；hypotheses 明确是推断；用户说法保留在 conversation，不能当日志事实。更新 notes 替换旧笔记，重要的有效信息应保留。最多固定8条证据，其余证据可以按 id 重新读取。
只可引用当前 evidence 的编号。历史报告和笔记可能已过时，不能作为独立原始证据。工具错误会返回给你，请修正参数或换方向，不能把工具错误当日志故障。
遇到歧义时 ask，随后用户回复会继续当前会话。证据不足也可以结束，不必为了消耗预算调用工具。
只输出调查动作、可核查笔记或结论，不输出隐藏推理过程。`;
function createSession(store){return {id:randomUUID(),datasetId:store.id,conversation:[],notes:{facts:[],hypotheses:[],openQuestions:[],pinIds:[]},evidence:new Map(),history:[],lastTool:null,lastDiagnosis:null,status:'ready',calls:0,usage:{inputTokens:0,outputTokens:0},archivedTurns:0};}
function validText(s,max=4000){return typeof s==='string'&&s.trim()&&s.length<=max;}
function notesValue(value,session){
 if(Buffer.byteLength(JSON.stringify(value??null))>14000)throw Error('调查笔记超过14 KiB，请精简并保留关键事实与引用');
 if(!value||!Array.isArray(value.facts)||!Array.isArray(value.hypotheses)||!Array.isArray(value.openQuestions)||!Array.isArray(value.pinIds))throw Error('notes 结构无效');
 const rows=items=>{if(items.length>12)throw Error('笔记每类最多12项');return items.map(x=>{if(!validText(x?.text,1000)||!Array.isArray(x.evidenceIds)||!x.evidenceIds.length||x.evidenceIds.length>8||!x.evidenceIds.every(id=>session.evidence.has(id)))throw Error('笔记必须引用已读取的证据');return {text:x.text,evidenceIds:[...new Set(x.evidenceIds)]};});};
 if(value.openQuestions.length>12||!value.openQuestions.every(x=>validText(x,500))||value.pinIds.length>8||!value.pinIds.every(id=>session.evidence.has(id)))throw Error('笔记问题或固定证据无效');
 return {facts:rows(value.facts),hypotheses:rows(value.hypotheses),openQuestions:value.openQuestions,pinIds:[...new Set(value.pinIds)]};
}
function putEvidence(session,items){
 for(const item of items){session.evidence.delete(item.id);session.evidence.set(item.id,item);}
 while(session.evidence.size>48){const id=[...session.evidence.keys()].find(id=>!session.notes.pinIds.includes(id));if(!id)break;session.evidence.delete(id);}
}
function stateFor(session,store,remaining){
 const state={overview:store.overview(),conversation:[...session.conversation],archivedTurns:session.archivedTurns,notes:session.notes,history:session.history,lastTool:session.lastTool,lastDiagnosis:session.lastDiagnosis?{status:session.lastDiagnosis.status,summary:session.lastDiagnosis.summary,note:'先前结论，可能已过时，不是原始证据'}:null,evidence:[...session.evidence.values()],remainingRounds:remaining};
 // Complete serialized state is bounded; summaries never silently become source evidence.
 const size=()=>Buffer.byteLength(JSON.stringify(state));
 while(size()>58000&&state.evidence.length){const index=state.evidence.findIndex(x=>!session.notes.pinIds.includes(x.id));if(index<0)break;const [removed]=state.evidence.splice(index,1);session.evidence.delete(removed.id);}
 while(size()>64000&&state.conversation.length>2){state.conversation.splice(1,1);state.archivedTurns++;}
 while(size()>64000&&state.history.length){state.history=state.history.slice(1);}
 if(size()>72000)throw Error('会话上下文达到上限，请新建调查或缩小数据集');
 return state;
}
function result(session,kind,extra={}){session.status=kind;return {kind,sessionId:session.id,notes:session.notes,calls:session.calls,usage:{...session.usage},...extra};}
async function runAgent({store,question,session=createSession(store),config,signal,onProgress=()=>{},fetchImpl=fetch,mode='quick',maxRounds}){
 if(session.datasetId!==store.id)throw Error('诊断会话不属于当前数据集');
 if(!validText(question))throw Error('请填写1至4000字的问题或补充信息');
 if(!config.endpoint||!config.model||!config.apiKey)throw Error('请先配置模型地址、模型名称和 API Key');
 const profile=PROFILES[mode];if(!profile)throw Error('未知调查模式');
 if(maxRounds!==undefined&&(!Number.isInteger(maxRounds)||maxRounds<1||maxRounds>32))throw Error('调查轮数无效');
 signal.throwIfAborted();
 session.conversation.push({role:'user',text:store.redact(question)});
 while(session.conversation.length>16){session.conversation.splice(1,1);session.archivedTurns++;}
 session.status='running';
 const rounds=maxRounds??profile.rounds;
 const pause=reason=>result(session,'paused',{message:reason,diagnosis:session.lastDiagnosis});
 if(!store.count)return pause('没有可解析日志，请导入日志后新建调查。');
 for(let round=0;round<rounds;round++){
  if(signal.aborted)return pause('调查已停止，已获取的证据和笔记保留。');

  onProgress({round:round+1,message:`第 ${round+1} 轮：模型正在选择下一步调查动作`});
  const state=stateFor(session,store,rounds-round);
  const callSignal=signal; // No application deadline; only explicit cancellation.
  let action;
  try{
   const response=await fetchImpl(config.endpoint,{method:'POST',redirect:'error',signal:callSignal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},body:JSON.stringify({model:config.model,store:false,max_completion_tokens:4000,response_format:{type:'json_object'},messages:[{role:'system',content:INSTRUCTIONS},{role:'user',content:JSON.stringify(state)}]})});
   session.calls++;
   if(!response.ok){await response.body?.cancel();return pause('模型服务拒绝请求，请检查连接配置或额度后继续。');}
   const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>128*1024)throw Error('模型返回超过限制');chunks.push(Buffer.from(chunk));}
   const payload=JSON.parse(Buffer.concat(chunks).toString('utf8')),choice=payload.choices?.[0];
   for(const [key,field]of [['inputTokens','prompt_tokens'],['outputTokens','completion_tokens']])if(Number.isSafeInteger(payload.usage?.[field])&&payload.usage[field]>=0)session.usage[key]+=payload.usage[field];
   if(choice?.finish_reason!=='stop'||choice.message?.refusal)throw Error('模型输出不完整或拒绝回答，请缩短输出或调整模型');
   action=JSON.parse(choice.message.content);
  }catch(error){
   if(signal.aborted)return pause('调查已停止，证据和笔记保留。');

   return pause('模型连接或输出格式异常，请检查配置后继续。');
  }
  if(signal.aborted)return pause('调查已停止，证据和笔记保留。');
  try{
   if(!action||typeof action!=='object'||Array.isArray(action)||['tool','ask','notes','diagnosis'].filter(k=>Object.hasOwn(action,k)).length!==1)throw Error('每轮必须且只能提交一种动作');
   if(action.ask){
    if(!validText(action.ask.question,1500)||!Array.isArray(action.ask.options)||action.ask.options.length>4||!action.ask.options.every(x=>validText(x,200)))throw Error('ask 需要 question 和最多4项 options');
    const ask={question:store.redact(action.ask.question),options:action.ask.options.map(store.redact)};
    session.conversation.push({role:'assistant',text:ask.question});
    return result(session,'needs_input',{ask});
   }
   if(action.notes){session.notes=notesValue(action.notes,session);session.lastTool={tool:'notes',updated:true};onProgress({round:round+1,message:'已更新调查笔记与关键证据',notes:session.notes});continue;}
   if(action.diagnosis){
    const diagnosis=validateResult(action.diagnosis,[...session.evidence.values()]);session.lastDiagnosis=diagnosis;
    session.conversation.push({role:'assistant',text:diagnosis.summary});
    return result(session,'complete',{diagnosis});
   }
   const value=store.query(action.tool,action.args);
   putEvidence(session,value.evidence||[]);
   session.lastTool={tool:action.tool,...value};
   // Original excerpts live in evidence, not duplicated in historical tool output.
   session.lastTool.evidence=(value.evidence||[]).map(e=>({id:e.id}));
   const entry={tool:action.tool,args:action.args,total:value.total,basis:value.basis,truncated:value.truncated,nextOffset:value.nextOffset,ids:(value.evidence||[]).map(e=>e.id)};
   const repeat=session.history.some(x=>JSON.stringify([x.tool,x.args])===JSON.stringify([entry.tool,entry.args]));
   if(repeat)session.lastTool.notice='此查询先前执行过，结果可能没有新增信息。请自主决定重读、换方向、询问用户或结束。';
   session.history.push(entry);if(session.history.length>16)session.history.shift();
   onProgress({round:round+1,message:`执行 ${action.tool}：返回 ${(value.evidence||[]).length} 条证据${value.truncated?'，可继续翻页':''}`});
  }catch(error){
   session.lastTool={error:String(error.message).slice(0,500),instruction:'修正动作或参数后继续，不将工具错误解释为日志故障。'};
   onProgress({round:round+1,message:'动作校验未通过，已反馈给模型调整'});
  }
 }
 return pause('达到本次调查预算。现有证据和笔记已保留，可继续深入调查。');
}
module.exports={runAgent,createSession,stateFor,PROFILES};

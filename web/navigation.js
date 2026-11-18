const analysisTabs=['summary','ai','logs','business','requests','report','issues'];
let activeAnalysisTab='summary';
function selectAnalysisTab(name,moveFocus=false){
 if(!analysisTabs.includes(name))return;
 activeAnalysisTab=name;
 for(const key of analysisTabs){
  const selected=key===name,tab=$('tab-'+key);
  tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
  $('panel-'+key).hidden=!selected;
 }
 if(moveFocus)$('tab-'+name).focus();
}
for(const name of analysisTabs){
 const tab=$('tab-'+name);
 tab.onclick=()=>selectAnalysisTab(name);
 tab.onkeydown=event=>{
  const i=analysisTabs.indexOf(name);let next;
  if(event.key==='ArrowRight')next=(i+1)%analysisTabs.length;
  if(event.key==='ArrowLeft')next=(i+analysisTabs.length-1)%analysisTabs.length;
  if(event.key==='Home')next=0;
  if(event.key==='End')next=analysisTabs.length-1;
  if(next!==undefined){event.preventDefault();selectAnalysisTab(analysisTabs[next],true);}
 };
}
$('goIssues').onclick=()=>selectAnalysisTab('issues',true);
$('goLogs').onclick=()=>selectAnalysisTab('logs',true);
selectAnalysisTab('summary');
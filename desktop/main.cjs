'use strict';
const {app,BrowserWindow,ipcMain,protocol,session}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const {configFromEnv}=require('../server/index.cjs');
const {createStore}=require('./store.cjs');
const {runAgent,createSession}=require('./agent.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'loglens',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let win,store,controller,sessionState,config=configFromEnv();
const resources=['index.html','style.css','parser.js','import.js','app.js','business-ui.js','issue-model.js','analysis.js','insights.js','focus.js','request-dashboard.js','workflows.js','navigation.js','desktop-ui.js'];
const origin='loglens://app';
const smokeDir=app.isPackaged?path.dirname(process.execPath):app.getAppPath();
if(process.argv.includes('--smoke'))app.setPath('userData',path.join(smokeDir,'.smoke-profile'));
const csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'";
function cancel(){controller?.abort();}
function register(name,handler){ipcMain.handle('loglens:'+name,async(event,data)=>{
  if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!event.senderFrame.url.startsWith(origin+'/'))throw Error('不允许的调用来源');
  return handler(data);
});}
register('configure',settings=>{
  if(controller)throw Error('请先停止当前诊断');
  if(!settings||typeof settings.baseUrl!=='string'||typeof settings.model!=='string'||typeof settings.apiKey!=='string'||settings.baseUrl.length>2000||settings.model.length>200||settings.apiKey.length>4096)throw Error('模型配置无效');
  config=configFromEnv({AI_BASE_URL:settings.baseUrl.trim(),AI_MODEL:settings.model.trim(),AI_API_KEY:settings.apiKey.trim()});
  if(!config.endpoint||!config.model||!config.apiKey)throw Error('请填写完整模型配置');
  return {configured:true};
});
register('import',data=>{cancel();store=createStore(data);sessionState=null;return {datasetId:store.id,count:store.count};});
register('cancel',()=>{cancel();return true;});
register('diagnose',async data=>{
  if(controller)throw Error('已有诊断正在执行');
  if(!store||data?.datasetId!==store.id)throw Error('日志已变化，请重新发起诊断');
  if(data.newSession||!sessionState)sessionState=createSession(store);
  const current=store,activeSession=sessionState,abort=new AbortController();controller=abort;
  try{
    const outcome=await runAgent({store:current,session:activeSession,mode:data.mode||'quick',question:data.question,config,signal:abort.signal,onProgress:progress=>{if(!win?.isDestroyed())win.webContents.send('loglens:progress',{datasetId:current.id,...progress});}});
    if(store!==current||sessionState!==activeSession)throw Error('数据集变化或诊断已取消');
    return {datasetId:current.id,...outcome};
  }finally{if(controller===abort)controller=null;}
});
async function openWindow(){
  win=new BrowserWindow({width:1320,height:900,minWidth:800,minHeight:600,title:'LogLens',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.on('closed',()=>{cancel();store=null;sessionState=null;win=null;});
  await win.loadURL(origin+'/index.html');
  if(process.argv.includes('--smoke')){
    try {
      await require('./smoke.cjs')(win,smokeDir);app.quit();
    }catch(error){console.error(error.message);app.exit(1);}
  }
}
app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  protocol.handle('loglens',async request=>{
    const url=new URL(request.url),name=url.pathname.slice(1);
    if(url.host!=='app'||!resources.includes(name))return new Response('Not found',{status:404});
    try{
      const body=await fs.readFile(path.join(__dirname,'../web',name));
      const type=name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript';
      return new Response(body,{headers:{'Content-Type':type+'; charset=utf-8','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'}});
    }catch{return new Response('Resource unavailable',{status:500});}
  });
  await openWindow();
  app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)openWindow();});
}).catch(error=>{console.error('Desktop startup failed:',error.message);app.exit(1);});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('before-quit',cancel);

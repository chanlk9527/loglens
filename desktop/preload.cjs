const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('loglensDesktop',{
  configure: settings=>ipcRenderer.invoke('loglens:configure',settings),
  importDataset: data=>ipcRenderer.invoke('loglens:import',data),
  diagnose: data=>ipcRenderer.invoke('loglens:diagnose',data),
  cancel: ()=>ipcRenderer.invoke('loglens:cancel'),
  onProgress: callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('loglens:progress',listener);return()=>ipcRenderer.removeListener('loglens:progress',listener);}
});

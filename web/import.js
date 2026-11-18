/* ZIP containers are decoded in memory. No paths are written to disk. */
async function unpackZip(file,limit){
 const buffer=await file.arrayBuffer(),view=new DataView(buffer),bytes=new Uint8Array(buffer),files=[],reports=[];
 const u16=p=>view.getUint16(p,true),u32=p=>view.getUint32(p,true);
 const fail=()=>{throw new Error('无法识别完整 ZIP 目录；也可能是进程透明解密视图不同');};
 let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(u32(p)===0x06054b50&&p+22+u16(p+20)===bytes.length){end=p;break;}
 if(end<0)fail();
 const count=u16(end+10),size=u32(end+12),offset=u32(end+16);
 if(u16(end+4)||u16(end+6)||u16(end+8)!==count||count===65535||offset===0xffffffff)throw new Error('暂不支持分卷或 ZIP64，请解压后导入文本');
 if(count>5000)throw new Error('ZIP 条目超过 5,000，请按日期拆分');
 if(offset+size>end)fail();
 let p=offset,total=0;
 for(let i=0;i<count;i++){
  if(p+46>offset+size||u32(p)!==0x02014b50)fail();
  const flags=u16(p+8),method=u16(p+10),crc=u32(p+16),compressed=u32(p+20),expanded=u32(p+24),nameLength=u16(p+28),extra=u16(p+30),comment=u16(p+32),local=u32(p+42);
  if(p+46+nameLength+extra+comment>offset+size)fail();
  let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(p+46,p+46+nameLength));}catch{ name=`未识别文件名-${i+1}`; }
  p+=46+nameLength+extra+comment;if(name.endsWith('/'))continue;
  const full=`${file.webkitRelativePath||file.name}!/${name}`;
  const skip=message=>reports.push({name:full,state:'unsupported',count:0,status:'跳过：'+message});
  if(!/\.(log|txt)$/i.test(name)){skip('ZIP 内暂不支持的格式；.xlog / .mmap3 请提供对应 SDK 解码后的文本');continue;}
  if(flags&1){skip('加密 ZIP，请在本地解压后导入');continue;}
  if(![0,8].includes(method)){skip('暂不支持该压缩算法，请本地解压后导入');continue;}
  if(name.split(/[\\/]/).includes('..')){skip('包含不规范的相对路径');continue;}
  if(expanded>limit-total)throw new Error('ZIP 解压后文本超过剩余 100 MB 总预算，请拆分导入');
  if(local+30>offset||u32(local)!==0x04034b50)fail();
  const start=local+30+u16(local+26)+u16(local+28);
  if(start+compressed>offset)fail();
  const blob=new Blob([bytes.subarray(start,start+compressed)]);
  let stream=blob.stream();
  if(method===8){try{stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw new Error('浏览器不支持 ZIP 解压，请先在本地解压后导入');}}
  const reader=stream.getReader(),chunks=[];let length=0,check=0xffffffff;
  try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>expanded||length>limit-total)throw new Error('ZIP 展开大小超限');chunks.push(value);for(const byte of value){check^=byte;for(let bit=0;bit<8;bit++)check=(check>>>1)^((check&1)?0xedb88320:0);}}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  if(length!==expanded||((check^0xffffffff)>>>0)!==crc)throw new Error('ZIP 条目校验不一致，请检查完整性或进程解密视图');
  total+=length;const result=new Blob(chunks);files.push({name:full,size:length,stream:()=>result.stream()});
 }
 return {files,reports,total};
}
async function decodeInputs(inputs,progress,options={}){
 const all=[],reports=[],files=[],names=new Map();let total=0;
 const limit=100*1024*1024;
 if(inputs.filter(f=>/\.(log|txt|zip)$/i.test(f.name)).reduce((n,f)=>n+f.size,0)>limit)throw new Error('输入总大小超过 100 MB，请分批导入');
 for(const f of inputs){
  const name=f.webkitRelativePath||f.name;
  if(/\.zip$/i.test(f.name)){
   try{const result=await unpackZip(f,limit-total);total+=result.total;files.push(...result.files);reports.push(...result.reports);reports.push({name,state:'container',count:result.files.length,status:`ZIP 已展开：${result.files.length} 个文本条目；分析结果见条目明细`});}
   catch(e){reports.push({name,state:'error',count:0,status:'未导入：'+e.message});}
  }else if(/\.(log|txt)$/i.test(f.name)){
   if(total+f.size>limit){reports.push({name,state:'error',count:0,status:'未导入：展开后总文本超过 100 MB'});continue;}
   total+=f.size;files.push(f);
  }else reports.push({name,state:'unsupported',count:0,status:'跳过：不支持此格式；.xlog / .mmap3 需对应 SDK 解码工具及必要的密钥，请导出 .log / .txt 后导入。'});
 }
 for(let i=0;i<files.length;i++){
  const f=files[i],originalName=f.webkitRelativePath||f.name;
  const occurrence=(names.get(originalName)||0)+1;names.set(originalName,occurrence);
  const name=occurrence===1?originalName:originalName+' [重复来源 '+occurrence+']';
  try{
   const parser=createParser(name,options),decoder=new TextDecoder('utf-8',{fatal:true}),reader=f.stream().getReader();let rest='',lineCount=0;
   try{while(true){const {value,done}=await reader.read();if(done)break;rest+=decoder.decode(value,{stream:true});const lines=rest.split('\n');rest=lines.pop();for(const s of lines){parser.line(s.replace(/\r$/,''));lineCount++;}if(rest.length>8*1024*1024)throw new Error('单行超过 8 MB，请检查格式或拆分');}rest+=decoder.decode();if(rest){parser.line(rest.replace(/\r$/,''));lineCount++;}}
   catch(e){await reader.cancel().catch(()=>{});throw e;}
   const result=parser.finish();if(all.length+result.events.length>250000)throw new Error('超过 250,000 条事件，请按日期分批导入');
   for(const e of result.events)all.push(e);
   const ordered=result.events.filter(e=>Number.isFinite(e.stamp)).sort((a,b)=>a.stamp-b.stamp);
   reports.push({name,state:result.events.length?'parsed':'unrecognized',count:result.events.length,unmatched:result.unmatched,invalidHeaders:result.invalidHeaders,blankLines:result.blankLines,lineCount,start:ordered[0]?.time,end:ordered.at(-1)?.time,status:result.events.length?`${result.events.length.toLocaleString()} 条事件，${result.unmatched} 行未归属（含 ${result.invalidHeaders} 行无效日志头）；${ordered[0]?.time} 至 ${ordered.at(-1)?.time}`:`未识别标准日志头；${result.unmatched} 行未归属（含 ${result.invalidHeaders} 行无效日志头）；请检查格式或进程解密视图`});
  }catch(e){reports.push({name,state:'error',count:0,status:'未导入：'+e.message+'。若无法解码，请检查进程透明解密视图，不自动判断文件损坏。'});}
  progress(i+1,files.length);
 }
 return {events:all,reports,stats:correlate(all)};
}
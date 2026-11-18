param([Parameter(Mandatory=$true)][string]$LogDirectory, [switch]$IncludeModules)
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
function Read-AuditText([string]$Path) {
    try { return [System.IO.File]::ReadAllText($Path, $utf8) }
    catch {
        $lines = & rg -a --no-line-number '^' $Path
        if ($LASTEXITCODE -ne 0) { throw "Cannot read $Path" }
        return $lines -join "`n"
    }
}
$payload = @{ source = ((Read-AuditText (Join-Path $PSScriptRoot 'parser.js')) + "`n" + (Read-AuditText (Join-Path $PSScriptRoot 'import.js'))); logs = @(); includeModules = [bool]$IncludeModules }
foreach ($file in Get-ChildItem -LiteralPath $LogDirectory -Recurse -File | Where-Object { $_.Extension -in '.log','.txt' }) {
    $payload.logs += @{ name=$file.FullName; text=(Read-AuditText $file.FullName) }
}
$runner = @'
const vm=require('node:vm'),assert=require('node:assert/strict');
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',async()=>{
 const data=JSON.parse(input),ctx=vm.createContext({Blob,File,TextDecoder,DecompressionStream});vm.runInContext(data.source,ctx);
 const result={files:0,physicalLines:0,headers:0,events:0,unmatched:0,levels:{},rawLevels:{},business:{},kinds:{},issues:{level:0,content:0},businessByModule:{}};
 const add=(map,key)=>map[key]=(map[key]||0)+1;
 for(const f of data.logs){
  const lines=f.text.split(/\r?\n/);if(lines.at(-1)==='')lines.pop();
  const p=ctx.createParser(f.name),content=ctx.createParser(f.name,{anomalyMode:'content'});let headers=0;
  for(const line of lines){p.line(line);content.line(line);const head=line.match(/^\[(\d{4}-\d\d-\d\d[^\]]*)\]\s*\[([^\]]*)\]/);if(head){headers++;add(result.rawLevels,head[2]);}}
  const parsed=p.finish(),es=parsed.events;assert.equal(es.length,headers,'timestamp headers vs parsed events: '+f.name);
  for(const e of es){assert.equal(e.raw,lines.slice(e.line-1,e.endLine).join('\n'),'raw line coverage: '+f.name);add(result.levels,e.level);add(result.business,e.business.category||'unclassified');add(result.kinds,e.kind);if(e.issue)result.issues.level++;const category=e.business.category||'unclassified';result.businessByModule[category]??={};add(result.businessByModule[category],e.module);}
  assert.equal(es.reduce((n,e)=>n+e.endLine-e.line+1,0)+parsed.unmatched+parsed.blankLines,lines.length,'physical line accounting: '+f.name);
  result.issues.content+=content.finish().events.filter(e=>e.issue).length;
  result.files++;result.physicalLines+=lines.length;result.headers+=headers;result.events+=es.length;result.unmatched+=parsed.unmatched;
 }
 assert.equal(Object.values(result.levels).reduce((a,b)=>a+b,0),result.events);
 assert.equal(Object.values(result.business).reduce((a,b)=>a+b,0),result.events);
 const imported=await ctx.decodeInputs(data.logs.map(f=>new File([f.text],f.name)),()=>{});
 assert.equal(imported.events.length,result.events,'streamed full import vs individual parser totals');
 assert.equal(imported.reports.reduce((n,r)=>n+r.count,0),result.events,'file report counts vs imported total');
 assert(imported.reports.every(r=>r.state==='parsed'),'all supplied text files parsed');
 for(const [level,count]of Object.entries(result.levels))assert.equal(imported.events.filter(e=>e.level===level).length,count,'streamed severity count '+level);
 for(const [category,count]of Object.entries(result.business))assert.equal(imported.events.filter(e=>(e.business.category||'unclassified')===category).length,count,'streamed business count '+category);
 result.import={files:imported.reports.length,events:imported.events.length,requests:imported.stats};
 if(!data.includeModules)delete result.businessByModule;
 console.log(JSON.stringify(result,null,2));
});
'@
$payload | ConvertTo-Json -Depth 6 -Compress | & node -e $runner
if ($LASTEXITCODE -ne 0) { throw 'Log audit failed' }

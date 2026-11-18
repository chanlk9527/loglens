param([ValidateSet('Start','Test','Prepare','Smoke')][string]$Action='Start')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$stage=Join-Path $root '.desktop-stage'
$utf8=[System.Text.UTF8Encoding]::new($false,$true)
$OutputEncoding=[System.Text.UTF8Encoding]::new($false)
function Read-Source([string]$path){
    try { return [System.IO.File]::ReadAllText($path,$utf8) }
    catch { $lines=& rg -a --no-line-number '^' $path; if($LASTEXITCODE -ne 0){throw "Cannot read $path"}; return $lines -join "`n" }
}
$names=@('package.json','server/index.cjs','desktop/main.cjs','desktop/preload.cjs','desktop/store.cjs','desktop/agent.cjs','desktop/tests.cjs','desktop/ui-tests.cjs','desktop/smoke.cjs','web/index.html','web/style.css','web/parser.js','web/import.js','web/app.js','web/business-ui.js','web/issue-model.js','web/analysis.js','web/insights.js','web/focus.js','web/request-dashboard.js','web/workflows.js','web/navigation.js','web/desktop-ui.js')
$files=@{}
foreach($name in $names){$files[$name]=Read-Source (Join-Path $root $name)}
# Node writes a runtime snapshot from standard-input plaintext; it never reads encrypted source files.
$writer=@'
const fs=require('node:fs'),path=require('node:path');let data='';process.stdin.setEncoding('utf8');
process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{const {root,files}=JSON.parse(data);for(const [name,text]of Object.entries(files)){const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text,'utf8');}console.log('Prepared desktop runtime snapshot');});
'@
@{root=$stage;files=$files}|ConvertTo-Json -Depth 5 -Compress|& node -e $writer
if($LASTEXITCODE -ne 0){throw 'Preparation failed'}
$env:ELECTRON_CACHE=Join-Path $root '.electron-cache'
$env:electron_config_cache=Join-Path $root '.electron-cache'
$env:ELECTRON_BUILDER_CACHE=Join-Path $root '.builder-cache'
if($Action -eq 'Prepare'){return}
if($Action -eq 'Test'){& node (Join-Path $stage 'desktop/tests.cjs');if($LASTEXITCODE -ne 0){throw 'Agent tests failed'};$files['web/desktop-ui.js'] | & node (Join-Path $stage 'desktop/ui-tests.cjs')}
else {
    $electron=Join-Path $root 'node_modules/.bin/electron.cmd'
    if($Action -eq 'Smoke'){& $electron $stage --smoke}else{& $electron $stage}
}
if($LASTEXITCODE -ne 0){throw "Desktop $Action failed"}

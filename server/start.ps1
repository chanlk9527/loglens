param([switch]$Test)
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
function Read-Source([string]$path) {
    try { return [System.IO.File]::ReadAllText($path, $utf8) }
    catch {
        $lines = & rg -a --no-line-number '^' $path
        if ($LASTEXITCODE -ne 0) { throw "Cannot read source: $path" }
        return $lines -join "`n"
    }
}
$web = Join-Path (Split-Path $PSScriptRoot -Parent) 'web'
$assets = @{}
foreach ($name in @('index.html','style.css','parser.js','import.js','app.js','business-ui.js','issue-model.js','analysis.js','insights.js','focus.js','request-dashboard.js','workflows.js','navigation.js','desktop-ui.js')) {
    $assets['/' + $name] = Read-Source (Join-Path $web $name)
}
$payload = @{ source = (Read-Source (Join-Path $PSScriptRoot 'index.cjs')); assets = $assets; testSource = '' }
if ($Test) { $payload.testSource = Read-Source (Join-Path $PSScriptRoot 'server-tests.cjs') }
$runner = @'
const Module = require('node:module');
let input = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  try {
    const data = JSON.parse(input);
    const mod = new Module('loglens-server'); mod.filename = 'loglens-server.cjs'; mod.paths = [];
    mod._compile(data.source, mod.filename);
    if (data.testSource) {
      const run = new Function('require', 'backend', 'assets', data.testSource);
      await run(require, mod.exports, data.assets);
    } else {
      const config = mod.exports.configFromEnv();
      const server = mod.exports.createServer({assets: data.assets, config});
      server.on('error', error => { console.error('Server failed:', error.code || 'STARTUP_ERROR'); process.exitCode = 1; });
      server.listen(config.port, '127.0.0.1', () => console.log(`LogLens: http://127.0.0.1:${config.port} (AI ${config.endpoint && config.model && config.apiKey ? 'configured' : 'not configured'})`));
      process.on('SIGINT', () => { server.close(); server.closeAllConnections(); });
      process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); });
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
});
'@
$payload | ConvertTo-Json -Depth 8 -Compress | & node -e $runner
if ($LASTEXITCODE -ne 0) { throw 'LogLens server failed' }

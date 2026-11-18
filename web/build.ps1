$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
function Read-Source([string]$name) {
    $sourcePath = Join-Path $PSScriptRoot $name
    try { return [System.IO.File]::ReadAllText($sourcePath, $utf8) }
    catch {
        $lines = & rg -a --no-line-number '^' $sourcePath
        if ($LASTEXITCODE -ne 0) { throw "Cannot read source: $name" }
        return $lines -join "`n"
    }
}
$html = Read-Source 'index.html'
$css = Read-Source 'style.css'
$html = $html.Replace('<link rel="stylesheet" href="style.css">', "<style>$css</style>")
foreach ($name in @('parser.js','import.js','app.js','business-ui.js','issue-model.js','analysis.js','insights.js','focus.js','request-dashboard.js','workflows.js','navigation.js','desktop-ui.js')) {
    $source = Read-Source $name
    $html = $html.Replace("<script src=`"$name`"></script>", "<script>$source</script>")
}
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot 'LogLens.html'), $html, [System.Text.UTF8Encoding]::new($false))
Write-Output 'Built LogLens.html'
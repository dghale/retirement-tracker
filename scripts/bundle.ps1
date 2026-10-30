# ==========================================================================
# Bundles modular HTML, CSS, and JS into a single copy-pasteable HTML file:
# dist/retirement-planner.html
# ==========================================================================

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $root "dist"
if (-not (Test-Path $distDir)) {
  New-Item -ItemType Directory -Path $distDir | Out-Null
}

$html = Get-Content -Path (Join-Path $root "index.html") -Raw -Encoding UTF8
$css = Get-Content -Path (Join-Path $root "css/styles.css") -Raw -Encoding UTF8

# Inline CSS
$inlineStyleBlock = "<style>`r`n$css`r`n  </style>"
$html = $html.Replace('<link rel="stylesheet" href="css/styles.css" />', $inlineStyleBlock)

# Inline JS files in order
$jsFiles = @(
  "js/state.js",
  "js/parser.js",
  "js/engine/tax.js",
  "js/engine/trust.js",
  "js/engine/mortgage.js",
  "js/engine/simulator.js",
  "js/engine/montecarlo.js",
  "js/charts.js",
  "js/ui.js"
)

foreach ($relPath in $jsFiles) {
  $fullPath = Join-Path $root $relPath
  $jsContent = Get-Content -Path $fullPath -Raw -Encoding UTF8
  $tag = "<script src=""$relPath""></script>"
  $inlineScript = "<script>`r`n$jsContent`r`n  </script>"
  $html = $html.Replace($tag, $inlineScript)
}

$outFile = Join-Path $distDir "retirement-planner.html"
Set-Content -Path $outFile -Value $html -Encoding UTF8
Write-Output "Successfully bundled single-file application to: $outFile ($((Get-Item $outFile).Length) bytes)"

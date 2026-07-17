# リリースzipを作成する（manifest/observer/dist/icons を同梱）。
# 使い方: npm run package  （事前に npm run build を実行しておくこと）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$mv = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
if ($version -ne $mv) { throw "version mismatch: package.json=$version manifest.json=$mv" }

$zip = "zen-study-stats-$version.zip"
$stage = Join-Path $env:TEMP "zss-pkg-$version"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage, "$stage\dist", "$stage\icons" | Out-Null

Copy-Item manifest.json, observer.js $stage
Copy-Item dist\content.js "$stage\dist"
Copy-Item icons\icon16.png, icons\icon32.png, icons\icon48.png, icons\icon128.png "$stage\icons"

if (Test-Path $zip) { Remove-Item -Force $zip }
$items = Get-ChildItem -Path $stage
Compress-Archive -Path $items.FullName -DestinationPath $zip
Remove-Item -Recurse -Force $stage
Write-Output "packaged: $zip"

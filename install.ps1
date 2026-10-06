# open-todos installer for Windows (PowerShell)
$ErrorActionPreference = 'Stop'
$src      = Join-Path $PSScriptRoot 'open-todos'
$dest     = Join-Path $env:USERPROFILE '.claude\mods\open-todos'
$settings = Join-Path $env:USERPROFILE '.claude\settings.json'

New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Copy-Item -Recurse $src $dest

if (-not (Test-Path $settings)) { [IO.File]::WriteAllText($settings, '{}', (New-Object Text.UTF8Encoding($false))) }
Copy-Item $settings "$settings.bak-open-todos" -Force

$raw = Get-Content $settings -Raw
if ([string]::IsNullOrWhiteSpace($raw)) { $raw = '{}' }
$j = $raw | ConvertFrom-Json
if (-not $j.PSObject.Properties['env']) { $j | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) }

# CLAUDE_CODE_PLUGIN_DIRS is a list: keep the folders already there (e.g. token-usage) and add ours.
$d = $dest -replace '\\', '/'
$cur = ''
if ($j.env.PSObject.Properties['CLAUDE_CODE_PLUGIN_DIRS']) { $cur = [string]$j.env.CLAUDE_CODE_PLUGIN_DIRS }
$list = @($cur -split ';' | Where-Object { $_ -ne '' })
if ($list -notcontains $d) { $list += $d }
$j.env | Add-Member -Force -NotePropertyName CLAUDE_CODE_PLUGIN_DIRS -NotePropertyValue ($list -join ';')
$j.env | Add-Member -Force -NotePropertyName CLAUDE_CODE_PLUGIN_DIR_WATCH -NotePropertyValue '1'
[IO.File]::WriteAllText($settings, ($j | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))

Write-Host "已安裝到 $dest"
Write-Host "設定已更新（備份：$settings.bak-open-todos）"
Write-Host "請完全關閉並重新開啟 Claude Desktop。"

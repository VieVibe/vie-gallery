$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fixtureRoot = Join-Path $PSScriptRoot '../.cache/private-space-export-test'
[IO.Directory]::CreateDirectory($fixtureRoot) | Out-Null
$fixtureRoot = [IO.Path]::GetFullPath($fixtureRoot)
$source = Join-Path $fixtureRoot 'source'
[IO.Directory]::CreateDirectory((Join-Path $source '婚纱照/原片')) | Out-Null
$rawPath = '婚纱照/原片/IMG_0001.CR3'
$xmpPath = '婚纱照/原片/IMG_0001.xmp'
[IO.File]::WriteAllBytes((Join-Path $source $rawPath), [byte[]]@(0,255,1,10,13,0,89))
[IO.File]::WriteAllBytes((Join-Path $source $xmpPath), [Text.Encoding]::UTF8.GetBytes('<?xml?><修图参数 曝光="0.3"/>'))
$manifestFiles = @($rawPath, $xmpPath) | ForEach-Object {
    $full = Join-Path $source $_
    @{ path = $_; size = (Get-Item -LiteralPath $full).Length; sha256 = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant() }
}
function New-FixtureArchive([string]$name, [bool]$damage) {
    $path = Join-Path $fixtureRoot ($name + '-' + [guid]::NewGuid().ToString() + '.zip')
    $zip = [IO.Compression.ZipFile]::Open($path, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $manifestFiles) {
            $entry = $zip.CreateEntry($file.path)
            $stream = $entry.Open()
            try {
                $bytes = [IO.File]::ReadAllBytes((Join-Path $source $file.path))
                if ($damage -and $file.path -eq $rawPath) { $bytes[1] = 254 }
                $stream.Write($bytes, 0, $bytes.Length)
            } finally { $stream.Dispose() }
        }
        $entry = $zip.CreateEntry('__integrity_11111111-1111-4111-8111-111111111111.json')
        $stream = $entry.Open()
        try {
            $json = @{ algorithm = 'SHA-256'; files = @($manifestFiles) } | ConvertTo-Json -Depth 8 -Compress
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { $stream.Dispose() }
    } finally { $zip.Dispose() }
    return $path
}
$good = New-FixtureArchive 'good' $false
& (Join-Path $PSScriptRoot 'verify-private-space-export.ps1') -ArchivePath $good -SourceDirectory $source
$bad = New-FixtureArchive 'bad' $true
$rejected = $false
try { & (Join-Path $PSScriptRoot 'verify-private-space-export.ps1') -ArchivePath $bad | Out-Null }
catch { $rejected = $true }
if (-not $rejected) { throw '损坏 ZIP 未被校验工具拒绝。' }
[IO.File]::WriteAllBytes((Join-Path $source $rawPath), [byte[]]@(0,255,1,10,13,0,90))
$rejected = $false
try { & (Join-Path $PSScriptRoot 'verify-private-space-export.ps1') -ArchivePath $good -SourceDirectory $source | Out-Null }
catch { $rejected = $true }
if (-not $rejected) { throw '与本地原件不同的文件未被拒绝。' }
Write-Output '导出工具测试通过：中文目录、RAW/XMP 原件、损坏 ZIP 和本地原件差异。'

param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [string]$SourceDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ArchivePath).Path)
try {
    $manifests = @($zip.Entries | Where-Object { $_.FullName -match '^__integrity_[0-9a-f-]{36}\.json$' })
    if ($manifests.Count -ne 1) { throw '压缩包中应有且只有一份完整性清单。' }
    $reader = New-Object IO.StreamReader($manifests[0].Open(), [Text.Encoding]::UTF8)
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($manifest.algorithm -ne 'SHA-256' -or $null -eq $manifest.files) { throw '校验清单格式无效。' }
    $entries = New-Object 'System.Collections.Generic.Dictionary[string,System.IO.Compression.ZipArchiveEntry]' ([StringComparer]::Ordinal)
    foreach ($entry in $zip.Entries) {
        if ($entries.ContainsKey($entry.FullName)) { throw "压缩包存在重复路径：$($entry.FullName)" }
        $entries.Add($entry.FullName, $entry)
    }
    if ($entries.Count -ne @($manifest.files).Count + 1) { throw '压缩包文件数量与清单不一致。' }
    $sourceRoot = if ($SourceDirectory) { [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $SourceDirectory).Path).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar } else { $null }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $count = 0
    $total = [long]0
    foreach ($file in $manifest.files) {
        if (-not $seen.Add($file.path) -or -not $entries.ContainsKey($file.path)) { throw "文件缺失或清单重复：$($file.path)" }
        $entry = $entries[$file.path]
        if ($entry.Length -ne [long]$file.size) { throw "文件大小不符：$($file.path)" }
        $sha = [Security.Cryptography.SHA256]::Create()
        $stream = $entry.Open()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose(); $sha.Dispose() }
        if ($hash -cne $file.sha256) { throw "文件内容校验失败：$($file.path)" }
        if ($sourceRoot) {
            if ($file.path -match '(^/|\\|:|(^|/)\.\.(/|$))') { throw '清单中包含不安全的文件路径。' }
            $sourcePath = [IO.Path]::GetFullPath((Join-Path $sourceRoot $file.path))
            if (-not $sourcePath.StartsWith($sourceRoot, [StringComparison]::OrdinalIgnoreCase)) { throw '文件路径超出原件目录。' }
            $source = Get-Item -LiteralPath $sourcePath
            if ($source.Length -ne [long]$file.size -or (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.sha256) { throw "下载文件与本地原件不一致：$($file.path)" }
        }
        $count++
        $total += [long]$file.size
    }
    Write-Output "完整性校验通过：$count 个文件，$total 字节。"
    if ($sourceRoot) { Write-Output '全部文件与本地原件逐字节校验一致。' }
} finally { $zip.Dispose() }

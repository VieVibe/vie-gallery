param(
    [uri]$BaseUrl = 'https://gallery.vie-vibe.cn',
    [System.Security.SecureString]$Password
)
$ErrorActionPreference = 'Stop'
if ($BaseUrl.Scheme -ne 'https' -and -not $BaseUrl.IsLoopback) { throw '账号创建仅支持 HTTPS 或本机地址。' }
if (-not $Password) { $Password = Read-Host '请输入专用账号密码（不会保存到文件）' -AsSecureString }
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$origin = $BaseUrl.GetLeftPart([System.UriPartial]::Authority)
$csrf = Invoke-RestMethod -Uri "$origin/api/auth/csrf" -WebSession $session
$headers = @{ 'X-XSRF-TOKEN' = $csrf.token }
$pointer = [IntPtr]::Zero
$plain = $null
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $body = @{ email = 'rong@vie.com'; displayName = '私人珍藏'; password = $plain } | ConvertTo-Json -Compress
    try {
        $result = Invoke-RestMethod -Uri "$origin/api/auth/register" -Method Post -WebSession $session -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
    } catch {
        # A retry may find an account already created. Log in with the supplied
        # password; never reset or take over an existing account.
        $result = Invoke-RestMethod -Uri "$origin/api/auth/login" -Method Post -WebSession $session -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
    }
    if ($result.user.email -ne 'rong@vie.com' -or -not $result.user.id) { throw '服务器返回的账号信息不匹配。' }
    Write-Output '专用账号已验证：rong@vie.com'
    Write-Output "PRIVATE_SPACE_USER_ID=$($result.user.id)"
} finally {
    $plain = $null
    $body = $null
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    try { Invoke-RestMethod -Uri "$origin/api/auth/logout" -Method Post -WebSession $session -Headers $headers | Out-Null } catch { }
}

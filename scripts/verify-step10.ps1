param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,

  # Optional: If provided, the script will log in and run admin/brand-only checks.
  [string]$Email,
  [string]$Password,

  # Optional: Used for the product page smoke check. If omitted, a placeholder value is used.
  [string]$ProductSlug,

  # Optional: Brand name for target creation (admin only). Brand accounts ignore this.
  [string]$Brand,

  # Optional: File paths to upload. If omitted, temporary dummy files are generated.
  [string]$MindFile,
  [string]$VideoFile,
  [string]$ImageFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  Add-Type -AssemblyName System.Net.Http
} catch {
  # If the assembly can't be loaded, the script will fail later with a clear error.
}

function Write-Check([string]$Name, [bool]$Ok, [string]$Details = '') {
  $status = if ($Ok) { 'PASS' } else { 'FAIL' }
  if ($Details) {
    Write-Host ("[{0}] {1} - {2}" -f $status, $Name, $Details)
  } else {
    Write-Host ("[{0}] {1}" -f $status, $Name)
  }
}

function Normalize-BaseUrl([string]$u) {
  $x = $u.Trim()
  if (-not $x) { throw 'BaseUrl is required.' }
  if ($x.EndsWith('/')) { $x = $x.Substring(0, $x.Length - 1) }
  return $x
}

function New-HttpClient([string]$baseUrl) {
  $cookies = New-Object System.Net.CookieContainer
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.CookieContainer = $cookies
  $handler.AllowAutoRedirect = $true
  $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate

  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(45)
  $client.DefaultRequestHeaders.UserAgent.ParseAdd('MindAR-Step10-SmokeTest/1.0')
  try { $client.DefaultRequestHeaders.ExpectContinue = $false } catch {}

  return [pscustomobject]@{
    Client = $client
    Cookies = $cookies
    BaseUrl = $baseUrl
  }
}

function Invoke-Json(
  [Parameter(Mandatory = $true)]$http,
  [Parameter(Mandatory = $true)][string]$Method,
  [Parameter(Mandatory = $true)][string]$Path,
  $Body = $null
) {
  $uri = [Uri]::new($http.BaseUrl + $Path)
  $req = New-Object System.Net.Http.HttpRequestMessage($Method, $uri)
  $req.Headers.Accept.ParseAdd('application/json')

  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 12
    $req.Content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
  }

  $resp = $http.Client.SendAsync($req).GetAwaiter().GetResult()
  $text = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()

  $obj = $null
  if ($text) {
    try { $obj = $text | ConvertFrom-Json } catch { $obj = $null }
  }

  return [pscustomobject]@{
    StatusCode = [int]$resp.StatusCode
    Ok = $resp.IsSuccessStatusCode
    Text = $text
    Json = $obj
    FinalUri = $resp.RequestMessage.RequestUri.AbsoluteUri
  }
}

function Invoke-Text(
  [Parameter(Mandatory = $true)]$http,
  [Parameter(Mandatory = $true)][string]$Method,
  [Parameter(Mandatory = $true)][string]$Url
) {
  $req = New-Object System.Net.Http.HttpRequestMessage($Method, $Url)
  $resp = $http.Client.SendAsync($req).GetAwaiter().GetResult()
  $text = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  return [pscustomobject]@{
    StatusCode = [int]$resp.StatusCode
    Ok = $resp.IsSuccessStatusCode
    Text = $text
    FinalUri = $resp.RequestMessage.RequestUri.AbsoluteUri
  }
}

function Is-SuccessOrRedirect([int]$statusCode) {
  return ($statusCode -ge 200 -and $statusCode -lt 400)
}

function Looks-LikeHtml([string]$text) {
  if (-not $text) { return $false }
  return ($text -match '<!doctype\s+html|<html')
}

function Ensure-TempFile([string]$ext, [string]$label) {
  $name = "mindar-step10-$label-$([Guid]::NewGuid().ToString('N'))$ext"
  $path = Join-Path $env:TEMP $name
  "Step 10 smoke test file ($label)" | Out-File -FilePath $path -Encoding ascii
  return $path
}

function Upload-File($http, [string]$filePath, [string]$pathField, [string]$filenameOverride = $null) {
  if (-not (Test-Path -LiteralPath $filePath)) {
    throw "Upload file not found: $filePath"
  }

  # NOTE: Some Windows PowerShell/.NET combinations can produce multipart requests
  # that Cloudflare rejects (observed as 500) even though curl works.
  # For verification purposes, use curl.exe which is reliable here.
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) {
    throw 'curl.exe is required for /upload in this verification script.'
  }

  $outFile = Join-Path $env:TEMP ('step10-upload-out-' + [Guid]::NewGuid().ToString('N') + '.json')
  try {
    $uploadUrl = $http.BaseUrl + '/upload'
    $fileName = if ($filenameOverride) { $filenameOverride } else { [System.IO.Path]::GetFileName($filePath) }

    # curl form syntax: file=@path;filename=name
    $fileForm = "file=@$filePath;filename=$fileName"

    $status = & curl.exe -sS -o $outFile -w "%{http_code}" -X POST -F "path=$pathField" -F $fileForm $uploadUrl 2>&1
    $text = ''
    if (Test-Path -LiteralPath $outFile) {
      $text = Get-Content -LiteralPath $outFile -Raw -ErrorAction SilentlyContinue
    }

    $obj = $null
    if ($text) {
      try { $obj = $text | ConvertFrom-Json } catch { $obj = $null }
    }

    $code = 0
    try { $code = [int]$status } catch { $code = 0 }
    return [pscustomobject]@{
      StatusCode = $code
      Ok = ($code -ge 200 -and $code -lt 300)
      Text = $text
      Json = $obj
    }
  } finally {
    try { Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue } catch {}
  }
}

$BaseUrl = Normalize-BaseUrl $BaseUrl
$http = New-HttpClient $BaseUrl

$failures = New-Object System.Collections.Generic.List[string]

function Require([string]$name, [bool]$cond, [string]$details = '') {
  Write-Check -Name $name -Ok $cond -Details $details
  if (-not $cond) { $failures.Add($name) | Out-Null }
}

# --- Step 10 checks ---

# 1) Verify /api/auth/me logged out
$me0 = Invoke-Json $http 'GET' '/api/auth/me'
$loggedOutOk = $me0.Ok -and ($me0.Json -ne $null) -and ($me0.Json.user -eq $null)
Require 'GET /api/auth/me (logged out)' $loggedOutOk ("status=$($me0.StatusCode)")

# 2) Verify key pages load (static)
$shopIndex = Invoke-Text $http 'GET' ($BaseUrl + '/ecommerce/index.html')
Require 'GET /ecommerce/index.html loads' (Is-SuccessOrRedirect $shopIndex.StatusCode -and (Looks-LikeHtml $shopIndex.Text)) ("status=$($shopIndex.StatusCode) final=$($shopIndex.FinalUri)")

# 3) Verify legacy single-product redirects to product page
$slugToUse = if ($ProductSlug) { $ProductSlug.Trim() } else { 'placeholder-slug' }
$legacyUrl = $BaseUrl + '/ecommerce/single-product?product=' + [Uri]::EscapeDataString($slugToUse)
$legacy = Invoke-Text $http 'GET' $legacyUrl
$legacyLooksRedirectLike =
  ($legacy.FinalUri -match '/ecommerce/product(\.html)?') -or
  ($legacy.Text -match 'product(\.html)?')
$legacyOk = (Is-SuccessOrRedirect $legacy.StatusCode) -and $legacyLooksRedirectLike
Require 'Legacy /ecommerce/single-product.html routes to product page' $legacyOk ("status=$($legacy.StatusCode) final=$($legacy.FinalUri)")

# 4) Optional login + privileged tests
$canLogin = ($Email -and $Password)
if ($canLogin) {
  $login = Invoke-Json $http 'POST' '/api/auth/login' @{ email = $Email; password = $Password }
  Require 'POST /api/auth/login succeeds' $login.Ok ("status=$($login.StatusCode)")

  $me1 = Invoke-Json $http 'GET' '/api/auth/me'
  $loggedInOk = $me1.Ok -and ($me1.Json -ne $null) -and ($me1.Json.user -ne $null) -and ($me1.Json.user.email)
  Require 'GET /api/auth/me (logged in)' $loggedInOk ("status=$($me1.StatusCode)")

  # Upload 3 files (mind/video/image)
  $tempFiles = @()
  if (-not $MindFile)  { $MindFile  = Ensure-TempFile '.mind' 'mind';  $tempFiles += $MindFile }
  if (-not $VideoFile) { $VideoFile = Ensure-TempFile '.mp4'  'video'; $tempFiles += $VideoFile }
  if (-not $ImageFile) { $ImageFile = Ensure-TempFile '.jpg'  'image'; $tempFiles += $ImageFile }

  $skipDependent = $false
  try {
    $upMind  = Upload-File $http $MindFile  'mind'
    $upVideo = Upload-File $http $VideoFile 'videos'
    $upImage = Upload-File $http $ImageFile 'images'

    $mindUploadOk  = ($upMind.Ok  -and $upMind.Json -and $upMind.Json.ok -eq $true -and $upMind.Json.url)
    $videoUploadOk = ($upVideo.Ok -and $upVideo.Json -and $upVideo.Json.ok -eq $true -and $upVideo.Json.url)
    $imageUploadOk = ($upImage.Ok -and $upImage.Json -and $upImage.Json.ok -eq $true -and $upImage.Json.url)

    Require 'POST /upload (mind)'  $mindUploadOk  ("status=$($upMind.StatusCode)")
    Require 'POST /upload (video)' $videoUploadOk ("status=$($upVideo.StatusCode)")
    Require 'POST /upload (image)' $imageUploadOk ("status=$($upImage.StatusCode)")

    if (-not ($mindUploadOk -and $videoUploadOk -and $imageUploadOk)) {
      Write-Host '[INFO] Upload failed; skipping URL-resolve + targets/viewer/delete checks.'
      $skipDependent = $true
    }

    if (-not $skipDependent) {

    $nocache = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $getMind  = Invoke-Text $http 'GET' ($upMind.Json.url  + "?nocache=$nocache")
    $getVideo = Invoke-Text $http 'GET' ($upVideo.Json.url + "?nocache=$nocache")
    $getImage = Invoke-Text $http 'GET' ($upImage.Json.url + "?nocache=$nocache")

    Require 'Uploaded mind URL resolves'  $getMind.Ok  ("status=$($getMind.StatusCode)")
    Require 'Uploaded video URL resolves' $getVideo.Ok ("status=$($getVideo.StatusCode)")
    Require 'Uploaded image URL resolves' $getImage.Ok ("status=$($getImage.StatusCode)")

      # Create + activate a target using uploaded URLs
      $productKey = "smoke-step10-$([Guid]::NewGuid().ToString('N').Substring(0, 10))"
      $targetBody = @{
        name = "Step10 Smoke Target $productKey"
        product = $productKey
        mind_url = [string]$upMind.Json.url
        video_url = [string]$upVideo.Json.url
        image_url = [string]$upImage.Json.url
      }
      if ($Brand) { $targetBody.brand = $Brand }

      $create = Invoke-Json $http 'POST' '/api/targets' $targetBody
      $createdOk = $create.Ok -and ($create.Json -ne $null) -and ($create.Json.item -ne $null) -and ($create.Json.item.id)
      Require 'POST /api/targets creates target' $createdOk ("status=$($create.StatusCode)")

      if ($createdOk) {
        $targetId = [int]$create.Json.item.id
        $act = Invoke-Json $http 'POST' ("/api/targets/$targetId/activate") @{}
        Require 'POST /api/targets/:id/activate works' $act.Ok ("status=$($act.StatusCode)")

        $viewer = Invoke-Json $http 'GET' ("/api/viewer/active?product=$([Uri]::EscapeDataString($productKey))")
        $viewerOk = $viewer.Ok -and ($viewer.Json -ne $null) -and ($viewer.Json.videourl -eq $targetBody.video_url)
        Require 'GET /api/viewer/active returns activated target' $viewerOk ("status=$($viewer.StatusCode)")

        $del = Invoke-Json $http 'DELETE' ("/api/targets/$targetId") $null
        Require 'DELETE /api/targets/:id deletes target' $del.Ok ("status=$($del.StatusCode)")

        # Verify assets are gone from R2 by using unique query string (avoids cached success responses).
        $nocache2 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $mindGone  = Invoke-Text $http 'GET' ($targetBody.mind_url  + "?nocache=$nocache2")
        $videoGone = Invoke-Text $http 'GET' ($targetBody.video_url + "?nocache=$nocache2")
        $imageGone = Invoke-Text $http 'GET' ($targetBody.image_url + "?nocache=$nocache2")

        Require 'Deleted target mind asset returns 404'  ($mindGone.StatusCode -eq 404)  ("status=$($mindGone.StatusCode)")
        Require 'Deleted target video asset returns 404' ($videoGone.StatusCode -eq 404) ("status=$($videoGone.StatusCode)")
        Require 'Deleted target image asset returns 404' ($imageGone.StatusCode -eq 404) ("status=$($imageGone.StatusCode)")
      }
    }

    $logout = Invoke-Json $http 'POST' '/api/auth/logout' @{}
    Require 'POST /api/auth/logout succeeds' $logout.Ok ("status=$($logout.StatusCode)")
  } finally {
    foreach ($f in $tempFiles) {
      try { Remove-Item -LiteralPath $f -Force } catch {}
    }
  }
} else {
  Write-Host '[INFO] Email/Password not provided; skipping login, upload, targets, viewer-active, delete-target checks.'
}

$http.Client.Dispose()

if ($failures.Count -gt 0) {
  Write-Host ''
  Write-Host ("Step 10 verification FAILED: {0} checks failed." -f $failures.Count)
  exit 1
}

Write-Host ''
Write-Host 'Step 10 verification PASSED.'
exit 0

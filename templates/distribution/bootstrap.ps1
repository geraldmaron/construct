# .construct/bootstrap.ps1 — Windows PowerShell bootstrap shim.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .construct\bootstrap.ps1                   # probe + plan
#   powershell -ExecutionPolicy Bypass -File .construct\bootstrap.ps1 -Install          # ensure runtime
#   powershell -ExecutionPolicy Bypass -File .construct\bootstrap.ps1 -- <args…>        # invoke with args
#
# Mirrors bootstrap.sh: same resolution order (node_modules → npx → global →
# cached binary → docker → fail). Forwards every argument and stream.

[CmdletBinding()]
param(
  [switch]$Install,
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$ConstructArgs
)

$ErrorActionPreference = 'Stop'

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..')
$VersionFile = Join-Path $ScriptDir 'version'
$CacheBinDir = Join-Path $ScriptDir 'cache\bin'

$Version = ''
if (Test-Path $VersionFile) {
  $Version = (Get-Content $VersionFile -Raw).Trim()
}

function Test-NodeMin18 {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  $v = (node --version) -replace '^v',''
  $major = [int]($v.Split('.')[0])
  return ($major -ge 18)
}

function Resolve-Arch {
  switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { return 'x64' }
    'ARM64' { return 'arm64' }
    default { return '' }
  }
}

function Invoke-NodeModules {
  param([string[]]$Args)
  $bin = Join-Path $ProjectRoot 'node_modules\@geraldmaron\construct\bin\construct'
  if (-not (Test-Path $bin)) { return $false }
  & node $bin @Args
  exit $LASTEXITCODE
}

function Invoke-Npx {
  param([string[]]$Args)
  if (-not (Test-NodeMin18)) { return $false }
  if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { return $false }
  $spec = if ($Version) { "@geraldmaron/construct@$Version" } else { '@geraldmaron/construct' }
  & npx -p $spec -- construct @Args
  exit $LASTEXITCODE
}

function Invoke-Global {
  param([string[]]$Args)
  if (-not (Get-Command construct -ErrorAction SilentlyContinue)) { return $false }
  & construct @Args
  exit $LASTEXITCODE
}

function Invoke-CachedBinary {
  param([string[]]$Args)
  $arch = Resolve-Arch
  if (-not $arch) { return $false }
  $bin = Join-Path $CacheBinDir "construct-windows-$arch.exe"
  if (-not (Test-Path $bin)) { return $false }
  & $bin @Args
  exit $LASTEXITCODE
}

function Invoke-Docker {
  param([string[]]$Args)
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  $image = 'ghcr.io/geraldmaron/construct'
  if ($Version) { $image = "${image}:$Version" } else { $image = "${image}:latest" }
  & docker run --rm `
    -v "${ProjectRoot}:/work" -w /work `
    -v "$env:USERPROFILE\.construct:/data/.construct" `
    -e CONSTRUCT_PROJECT_ROOT=/work `
    $image @Args
  exit $LASTEXITCODE
}

if ($Install) {
  $bin = Join-Path $ProjectRoot 'node_modules\@geraldmaron\construct\bin\construct'
  if (Test-Path $bin) {
    Write-Host "[construct] node_modules install ready: $bin"
    exit 0
  }
  if ((Test-NodeMin18) -and (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Host '[construct] npx will resolve construct on first invocation.'
    exit 0
  }
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Host '[construct] docker available — bootstrap will use the container image on next run.'
    exit 0
  }
  $arch = Resolve-Arch
  if ($arch -and $Version -and (Get-Command curl -ErrorAction SilentlyContinue)) {
    $url = "https://github.com/geraldmaron/construct/releases/download/v$Version/construct-windows-$arch.exe"
    New-Item -ItemType Directory -Force -Path $CacheBinDir | Out-Null
    $target = Join-Path $CacheBinDir "construct-windows-$arch.exe"
    Write-Host "[construct] downloading binary to $target…"
    try {
      Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
      Write-Host '[construct] binary cached. Subsequent invocations use it.'
      exit 0
    } catch {
      Write-Host "[construct] binary download failed; falling through."
    }
  }
  Write-Error '[construct] No installable runtime detected. Install Node.js 18+, Docker, or curl + a release binary.'
  exit 127
}

# Default — resolve and invoke.
try { Invoke-NodeModules    $ConstructArgs } catch {}
try { Invoke-Npx            $ConstructArgs } catch {}
try { Invoke-Global         $ConstructArgs } catch {}
try { Invoke-CachedBinary   $ConstructArgs } catch {}
try { Invoke-Docker         $ConstructArgs } catch {}

$msg = @"
[construct] No Construct install found.

  This project pins Construct$($Version ? " $Version" : '') but no runtime resolved.

  Pick one:
    - Install Node.js 18+ from https://nodejs.org and re-run.
    - powershell -File .construct\bootstrap.ps1 -Install   (download a binary)
    - npm install -g @geraldmaron/construct
"@
Write-Error $msg
exit 127

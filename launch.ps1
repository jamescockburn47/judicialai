# Judicial Review Launcher - pure ASCII, no here-strings
# Works on all Windows machines regardless of regional settings

$Root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$EnvFile = Join-Path $Root ".env"
$CargoExe = "$env:USERPROFILE\.cargo\bin\cargo.exe"

# --- Prerequisites check ---

$prereqErrors = @()
$prereqWarnings = @()

Write-Host ""
Write-Host "Checking prerequisites..." -ForegroundColor Cyan

# Rust / cargo
$cargoFound = $false
if (Test-Path $CargoExe) {
    $cargoFound = $true
} else {
    $cargoCmd = Get-Command cargo -ErrorAction SilentlyContinue
    if ($cargoCmd) {
        $CargoExe = $cargoCmd.Source
        $cargoFound = $true
    }
}

if ($cargoFound) {
    $rustcBin = "$env:USERPROFILE\.cargo\bin\rustc.exe"
    if (Test-Path $rustcBin) {
        $rv = (& $rustcBin --version 2>&1)
    } else {
        $rv = (rustc --version 2>&1)
    }
    Write-Host "  Rust: $rv" -ForegroundColor Green
} else {
    $prereqErrors += "RUST NOT FOUND"
    $prereqErrors += "  Install from: https://rustup.rs"
    $prereqErrors += "  Run rustup-init.exe, then restart this terminal."
}

# Visual Studio Build Tools (needed by Rust on Windows)
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasMSVC = $false
if (Test-Path $vsWhere) {
    $vsOut = (& $vsWhere -products * -requires Microsoft.VisualCpp.Tools.HostX64.TargetX64 2>&1)
    if ($vsOut -and ("$vsOut" -ne "")) { $hasMSVC = $true }
}
if (-not $hasMSVC) {
    if (Get-Command cl -ErrorAction SilentlyContinue) { $hasMSVC = $true }
}
if ($hasMSVC) {
    Write-Host "  Visual Studio Build Tools: found" -ForegroundColor Green
} elseif ($cargoFound) {
    $prereqWarnings += "Visual Studio Build Tools may be missing."
    $prereqWarnings += "  If the build fails, install from:"
    $prereqWarnings += "  https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    $prereqWarnings += "  Select Desktop development with C++ and click Install."
}

# Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVer = (node --version 2>&1).Trim()
    $nodeMajor = 0
    if ($nodeVer -match '^v(\d+)') { $nodeMajor = [int]$Matches[1] }
    if ($nodeMajor -ge 18) {
        Write-Host "  Node.js: $nodeVer" -ForegroundColor Green
    } else {
        $prereqErrors += "NODE.JS TOO OLD: $nodeVer (need v18+)"
        $prereqErrors += "  Download LTS from: https://nodejs.org"
        $prereqErrors += "  Install, then restart this terminal."
    }
} else {
    $prereqErrors += "NODE.JS NOT FOUND"
    $prereqErrors += "  Download LTS from: https://nodejs.org"
    $prereqErrors += "  Install, then restart this terminal."
}

# Git
if (Get-Command git -ErrorAction SilentlyContinue) {
    $gitVer = (git --version 2>&1).Trim()
    Write-Host "  Git: $gitVer" -ForegroundColor Green
} else {
    $prereqErrors += "GIT NOT FOUND"
    $prereqErrors += "  Install from: https://git-scm.com/download/win"
    $prereqErrors += "  Use default options, then restart this terminal."
}

# WebView2
$wv2a = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
$wv2b = "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
if ((Test-Path $wv2a) -or (Test-Path $wv2b)) {
    Write-Host "  WebView2: installed" -ForegroundColor Green
} else {
    $prereqWarnings += "WebView2 not detected. If the app fails to open:"
    $prereqWarnings += "  https://developer.microsoft.com/microsoft-edge/webview2/"
}

# Print warnings
if ($prereqWarnings.Count -gt 0) {
    Write-Host ""
    foreach ($w in $prereqWarnings) { Write-Host "WARNING: $w" -ForegroundColor Yellow }
}

# Stop on errors
if ($prereqErrors.Count -gt 0) {
    Write-Host ""
    Write-Host "Cannot launch - missing requirements:" -ForegroundColor Red
    foreach ($e in $prereqErrors) { Write-Host $e -ForegroundColor Red }
    Write-Host ""
    Write-Host "Fix the issues above and run launch.bat again." -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "All prerequisites met." -ForegroundColor Green
Write-Host ""

# --- Kill old processes ---

Write-Host "Clearing ports 8002 and 5175..."
foreach ($port in @(8002, 5175)) {
    $lines = netstat -ano | Select-String "[:.]$port\s" | Select-String "LISTENING"
    foreach ($line in $lines) {
        $pid_val = ($line.ToString().Trim() -split '\s+')[-1]
        if ($pid_val -match '^\d+$' -and [int]$pid_val -gt 0) {
            Stop-Process -Id ([int]$pid_val) -Force -ErrorAction SilentlyContinue
            Write-Host "  Killed PID $pid_val on port $port"
        }
    }
}
Start-Sleep -Milliseconds 600

# --- .env setup ---

if (-not (Test-Path $EnvFile)) {
    $exampleFile = Join-Path $Root ".env.example"
    if (Test-Path $exampleFile) {
        Copy-Item $exampleFile $EnvFile
    } else {
        Set-Content -Path $EnvFile -Value "ANTHROPIC_API_KEY=your_key_here`nRUST_LOG=bs_detector=info" -Encoding ASCII
    }
    Write-Host ".env created."
}

$envContent = Get-Content $EnvFile -Raw -ErrorAction SilentlyContinue
if ($envContent -match "your_key_here") {
    Write-Host ""
    Write-Host "NOTE: ANTHROPIC_API_KEY is not set in .env" -ForegroundColor Yellow
    Write-Host "  Citation extraction and case retrieval work without it." -ForegroundColor Yellow
    Write-Host "  AI validation requires an Anthropic key." -ForegroundColor Yellow
    Write-Host "  Get one at: https://console.anthropic.com" -ForegroundColor Yellow
    Write-Host "  Edit .env and add: ANTHROPIC_API_KEY=sk-ant-..." -ForegroundColor Yellow
    Write-Host ""
}

# --- Seed demo matter ---

$demoSrc  = Join-Path $Root "frontend\src-tauri\demo-matters\rivera-v-harmon"
$demoDest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) "JudicialReview\rivera-v-harmon"
if (-not (Test-Path (Join-Path $demoDest "matter.json"))) {
    Write-Host "Seeding demo matter..."
    New-Item -ItemType Directory -Force (Join-Path $demoDest "documents") | Out-Null
    Copy-Item (Join-Path $demoSrc "matter.json") $demoDest -Force
    Copy-Item (Join-Path $demoSrc "documents\*") (Join-Path $demoDest "documents") -Force
    Write-Host "  Seeded Rivera v. Harmon to $demoDest"
}

# --- Read env vars ---

$envLines = Get-Content $EnvFile -ErrorAction SilentlyContinue
$envExportLines = @()
foreach ($line in $envLines) {
    if ($line -match "^([A-Za-z_][A-Za-z0-9_]*)=(.+)$") {
        $envExportLines += [string]::Format('$env:{0} = ''{1}''', $Matches[1], $Matches[2])
    }
}

# --- Build and write backend script using Set-Content (no here-strings) ---

$backendLines = @()
$backendLines += $envExportLines
$backendLines += [string]::Format('$env:PATH = ''{0}\.cargo\bin;'' + $env:PATH', $env:USERPROFILE)
$backendLines += [string]::Format('Set-Location ''{0}''', $BackendDir)
$backendLines += "Write-Host 'Starting backend API...'"
$backendLines += [string]::Format('& ''{0}'' run --bin bs-detector', $CargoExe)

$backendScript = Join-Path $env:TEMP "jr_backend.ps1"
Set-Content -Path $backendScript -Value $backendLines -Encoding ASCII

Write-Host "Starting backend..."
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $backendScript -WindowStyle Normal

# --- Build and write Tauri script using Set-Content (no here-strings) ---

$tauriLines = @()
$tauriLines += [string]::Format('$env:PATH = ''{0}\.cargo\bin;'' + $env:PATH', $env:USERPROFILE)
$tauriLines += '$env:PATH = $env:PATH'
$tauriLines += [string]::Format('Set-Location ''{0}''', $FrontendDir)
$tauriLines += "if (-not (Test-Path 'node_modules')) {"
$tauriLines += "    Write-Host 'Installing npm packages (first run only)...'"
$tauriLines += "    npm install --prefer-offline --no-audit --no-fund"
$tauriLines += "    if (`$LASTEXITCODE -ne 0) {"
$tauriLines += "        Write-Host 'npm install failed. Trying with --legacy-peer-deps...'"
$tauriLines += "        npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund"
$tauriLines += "    }"
$tauriLines += "}"
$tauriLines += '$env:VITE_API_URL = ''http://localhost:8002'''
$tauriLines += "Write-Host 'Building Tauri app (first run ~5-10 min, then fast)...'"
$tauriLines += "npx tauri dev"

$tauriScript = Join-Path $env:TEMP "jr_tauri.ps1"
Set-Content -Path $tauriScript -Value $tauriLines -Encoding ASCII

Write-Host "Starting Tauri desktop app..."
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $tauriScript -WindowStyle Normal

Write-Host ""
Write-Host "Both windows are compiling. The desktop app opens automatically when ready." -ForegroundColor Cyan
Write-Host "Close both terminal windows to stop."

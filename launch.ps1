# Judicial Review Launcher
# Checks prerequisites, kills old instances, then starts backend and Tauri app.

$Root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$EnvFile = Join-Path $Root ".env"
$CargoExe = "$env:USERPROFILE\.cargo\bin\cargo.exe"

# --- Prerequisites check ---

$errors = @()
$warnings = @()

Write-Host ""
Write-Host "Checking prerequisites..." -ForegroundColor Cyan

# Rust / cargo
$cargoFound = $false
if (Test-Path $CargoExe) {
    $cargoFound = $true
} else {
    $cargoInPath = Get-Command cargo -ErrorAction SilentlyContinue
    if ($cargoInPath) {
        $CargoExe = $cargoInPath.Source
        $cargoFound = $true
    }
}

if ($cargoFound) {
    try {
        $rustcBin = "$env:USERPROFILE\.cargo\bin\rustc.exe"
        if (Test-Path $rustcBin) {
            $rustcVer = (& $rustcBin --version 2>&1).Trim()
        } else {
            $rustcVer = (rustc --version 2>&1).Trim()
        }
        Write-Host "  Rust: $rustcVer" -ForegroundColor Green
    } catch {
        Write-Host "  Rust: installed" -ForegroundColor Green
    }
} else {
    $errors += "RUST NOT FOUND`n  Install from: https://rustup.rs`n  Run the installer, then restart this terminal and try again."
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
        $errors += "NODE.JS TOO OLD: $nodeVer (need v18+)`n  Download LTS from: https://nodejs.org`n  Install, then restart this terminal."
    }
} else {
    $errors += "NODE.JS NOT FOUND`n  Download LTS from: https://nodejs.org`n  Install, then restart this terminal."
}

# Git
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($gitCmd) {
    $gitVer = (git --version 2>&1).Trim()
    Write-Host "  Git: $gitVer" -ForegroundColor Green
} else {
    $errors += "GIT NOT FOUND`n  Install from: https://git-scm.com/download/win`n  Use default options, then restart this terminal."
}

# npm
if (-not (Get-Command npm -ErrorAction SilentlyContinue) -and $nodeCmd) {
    $errors += "NPM NOT FOUND`n  npm should come with Node.js. Try reinstalling from https://nodejs.org"
}

# WebView2 (Tauri requirement on Windows, usually pre-installed on Win10/11)
$wv2a = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
$wv2b = "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
if ((Test-Path $wv2a) -or (Test-Path $wv2b)) {
    Write-Host "  WebView2: installed" -ForegroundColor Green
} else {
    $warnings += "WebView2 not detected. If the app fails to open, install it from:`n  https://developer.microsoft.com/microsoft-edge/webview2/"
}

# Print warnings (non-fatal)
foreach ($w in $warnings) {
    Write-Host ""
    Write-Host "WARNING: $w" -ForegroundColor Yellow
}

# Print errors and stop if any are fatal
if ($errors.Count -gt 0) {
    Write-Host ""
    Write-Host "Cannot launch - missing requirements:" -ForegroundColor Red
    foreach ($e in $errors) {
        Write-Host ""
        Write-Host "  $e" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Fix the issues above and run launch.bat again." -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "All prerequisites met." -ForegroundColor Green
Write-Host ""

# --- Kill old processes on ports 8002 and 5175 ---

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
    $example = Join-Path $Root ".env.example"
    if (Test-Path $example) {
        Copy-Item $example $EnvFile
    } else {
        Set-Content $EnvFile "ANTHROPIC_API_KEY=your_key_here`nRUST_LOG=bs_detector=info"
    }
    Write-Host ".env created."
}

$envContent = Get-Content $EnvFile -Raw -ErrorAction SilentlyContinue
if ($envContent -match "your_key_here") {
    Write-Host ""
    Write-Host "NOTE: ANTHROPIC_API_KEY is not set in .env" -ForegroundColor Yellow
    Write-Host "  Citation extraction and case retrieval work without it." -ForegroundColor Yellow
    Write-Host "  AI validation (Run Analysis) requires an Anthropic key." -ForegroundColor Yellow
    Write-Host "  Get one at: https://console.anthropic.com" -ForegroundColor Yellow
    Write-Host "  Edit .env in this folder and add: ANTHROPIC_API_KEY=sk-ant-..." -ForegroundColor Yellow
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

# --- Read env vars for backend ---

$envExports = ""
foreach ($line in (Get-Content $EnvFile -ErrorAction SilentlyContinue)) {
    if ($line -match "^([A-Za-z_][A-Za-z0-9_]*)=(.+)$") {
        $envExports += "`$env:$($Matches[1]) = '$($Matches[2])'`n"
    }
}

# --- Launch backend ---

$backendScript = Join-Path $env:TEMP "jr_backend.ps1"
Set-Content $backendScript @"
$envExports
`$env:PATH = '$env:USERPROFILE\.cargo\bin;' + `$env:PATH
Set-Location '$BackendDir'
Write-Host 'Starting backend API...'
& '$CargoExe' run --bin bs-detector
"@
Write-Host "Starting backend..."
Start-Process powershell -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$backendScript`"" -WindowStyle Normal

# --- Launch Tauri app ---

$tauriScript = Join-Path $env:TEMP "jr_tauri.ps1"
Set-Content $tauriScript @"
`$env:PATH = '$env:USERPROFILE\.cargo\bin;' + `$env:PATH
[System.Environment]::SetEnvironmentVariable('PATH', `$env:PATH, 'Process')
Set-Location '$FrontendDir'
if (-not (Test-Path 'node_modules')) {
    Write-Host 'Installing npm packages (first run only)...'
    npm install
}
`$env:VITE_API_URL = 'http://localhost:8002'
Write-Host 'Building Tauri app (first run ~3-5 min, then fast)...'
npx tauri dev
"@
Write-Host "Starting Tauri desktop app..."
Start-Process powershell -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$tauriScript`"" -WindowStyle Normal

Write-Host ""
Write-Host "Both windows are compiling. The desktop app opens automatically when ready." -ForegroundColor Cyan
Write-Host "Close both terminal windows to stop."

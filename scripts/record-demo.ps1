# record-demo.ps1

$ProjectRoot = "e:\programming\mvp1"
$Sentinel    = Join-Path $ProjectRoot ".demo-done"
$RawFile     = Join-Path $ProjectRoot "demo-raw.mkv"
$FinalFile   = Join-Path $ProjectRoot "demo.mp4"
$Launcher    = Join-Path $env:TEMP "talos-demo-launch.ps1"

if (Test-Path $Sentinel)  { Remove-Item $Sentinel }
if (Test-Path $RawFile)   { Remove-Item $RawFile }
if (Test-Path $FinalFile) { Remove-Item $FinalFile }

@"
Set-Location '$ProjectRoot'
node --import tsx/esm src/demo.ts
Write-Host "Demo finished." -ForegroundColor Green
Start-Sleep -Seconds 8
"@ | Out-File $Launcher -Encoding utf8

# 1. ffmpeg first
Write-Host "Starting ffmpeg..." -ForegroundColor Yellow
$ffmpeg = Start-Process -FilePath "ffmpeg" `
  -ArgumentList "-y -f gdigrab -framerate 30 -i desktop -c:v libx264 -preset fast -crf 18 ""$RawFile""" `
  -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

# 2. demo window
Write-Host "Launching demo window..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File ""$Launcher""" -WindowStyle Maximized
$recordStart = Get-Date

# 3. wait for sentinel
Write-Host "Waiting for demo..." -ForegroundColor DarkGray
$timeout = 300
while (-not (Test-Path $Sentinel)) {
  Start-Sleep -Seconds 2
  $timeout -= 2
  if ($timeout -le 0) { Write-Host "Timeout" -ForegroundColor Red; break }
}

$elapsed = [int]((Get-Date) - $recordStart).TotalSeconds + 8
Write-Host "Demo done. Capturing outro 8s..." -ForegroundColor DarkGray
Start-Sleep -Seconds 8

Write-Host "Killing ffmpeg..." -ForegroundColor Yellow
Stop-Process -Id $ffmpeg.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

$size = 0
if (Test-Path $RawFile) { $size = (Get-Item $RawFile).Length }
if ($size -lt 100000) {
  Write-Host "ERROR: MKV too small ($size bytes)" -ForegroundColor Red
  exit 1
}
$sizeMB = [math]::Round($size / 1MB, 1)
Write-Host "Raw MKV: $sizeMB MB" -ForegroundColor DarkGray

# 4. encode
$elapsedStr = "$elapsed"
Write-Host "Encoding $elapsedStr`s of video..." -ForegroundColor Cyan
& ffmpeg -y -i $RawFile -t $elapsed `
  -vf "scale=1920:1080:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" `
  -c:v libx264 -preset slow -crf 16 -movflags +faststart $FinalFile

if (Test-Path $FinalFile) {
  $finalMB = [math]::Round((Get-Item $FinalFile).Length / 1MB, 1)
  Write-Host ""
  Write-Host "Done! -> $FinalFile ($finalMB MB)" -ForegroundColor Green
} else {
  Write-Host "Encode failed. Raw: $RawFile" -ForegroundColor Red
}

<#
 Mesure le temps de démarrage de MDnote (clic -> onglet actif affiché).
 Lance l'exe N fois avec une note de 2 000 lignes + un tableau de 50 lignes ouverts,
 lit startup_ms dans %TEMP%\mdnote-startup.log et affiche la médiane.
 Usage : powershell -File scripts\measure-startup.ps1 [-Exe path] [-Runs 5]
#>
param(
  [string]$Exe = (Join-Path $PSScriptRoot "..\src-tauri\target\release\mdnote.exe"),
  [int]$Runs = 5,
  [int]$TimeoutSec = 30
)
$ErrorActionPreference = "Stop"
$Exe = (Resolve-Path $Exe).Path
$work = Join-Path $env:TEMP ("mdnote-measure-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$notes = Join-Path $work "notes"
$bin = Join-Path $work "bin"
New-Item -ItemType Directory -Force $notes, $bin | Out-Null
Copy-Item $Exe (Join-Path $bin "mdnote.exe")

# Note de test : 2 000 lignes de texte varié + tableau de 50 lignes.
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("# Note de mesure")
[void]$sb.AppendLine()
for ($i = 1; $i -le 1900; $i++) {
  switch ($i % 5) {
    0 { [void]$sb.AppendLine("## Section $i") }
    1 { [void]$sb.AppendLine("Ligne $i avec du **gras**, de l'*italique* et du ``code`` en ligne.") }
    2 { [void]$sb.AppendLine("- élément de liste $i") }
    3 { [void]$sb.AppendLine("Paragraphe $i : lorem ipsum dolor sit amet, consectetur adipiscing elit.") }
    4 { [void]$sb.AppendLine() }
  }
}
[void]$sb.AppendLine()
[void]$sb.AppendLine("| Colonne A | Colonne B | Colonne C |")
[void]$sb.AppendLine("| --- | --- | --- |")
for ($r = 1; $r -le 50; $r++) { [void]$sb.AppendLine("| a$r | b$r | c$r |") }
[System.IO.File]::WriteAllText((Join-Path $notes "grosse-note.md"), $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
$lines = ($sb.ToString() -split "`n").Count
Write-Host "Note générée : $lines lignes dont un tableau de 50 lignes"

$settings = @{
  root_dir = $notes
  open_tabs = @("grosse-note.md")
  active_tab = "grosse-note.md"
  recent_emojis = @()
  window_effect = "mica"
} | ConvertTo-Json
$settingsPath = Join-Path $bin "mdnote.settings.json"
$log = Join-Path $env:TEMP "mdnote-startup.log"

$results = @()
for ($run = 1; $run -le $Runs; $run++) {
  [System.IO.File]::WriteAllText($settingsPath, $settings, (New-Object System.Text.UTF8Encoding($false)))
  if (Test-Path $log) { Remove-Item $log -Force }
  $p = Start-Process -FilePath (Join-Path $bin "mdnote.exe") -PassThru
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $ms = $null
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $log) {
      $m = Select-String -Path $log -Pattern "startup_ms=(\d+)" | Select-Object -First 1
      if ($m) { $ms = [int]$m.Matches[0].Groups[1].Value; break }
    }
    Start-Sleep -Milliseconds 100
  }
  if ($null -eq $ms) { Write-Warning "Run $run : pas de startup_ms après $TimeoutSec s" } else { Write-Host "Run $run : $ms ms"; $results += $ms }
  # Laisse la restauration finir, puis ferme (les processus WebView2 enfants se terminent avec la fenêtre).
  Start-Sleep -Milliseconds 1500
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}

if ($results.Count -eq 0) { Write-Error "Aucune mesure."; exit 1 }
$sorted = $results | Sort-Object
$mid = [int][math]::Floor($sorted.Count / 2)
$median = if ($sorted.Count % 2) { $sorted[$mid] } else { [int](($sorted[$mid - 1] + $sorted[$mid]) / 2) }
Write-Host ("Mesures : " + ($results -join ", ") + " ms")
Write-Host "Médiane : $median ms (objectif < 1000)"
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
if ($median -lt 1000) { exit 0 } else { exit 2 }

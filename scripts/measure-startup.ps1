<#
 Mesure le temps de démarrage de myMDnotepad (clic -> onglet actif affiché).
 Lance l'exe N fois avec une note de 2 000 lignes + un tableau de 50 lignes + 5 schémas mermaid
 + 5 alertes + du texte surligné ouverts,
 lit startup_ms dans %TEMP%\mymdnotepad-startup.log et affiche la médiane.
 Usage : powershell -File scripts\measure-startup.ps1 [-Exe path] [-Runs 5]
#>
param(
  [string]$Exe = (Join-Path $PSScriptRoot "..\src-tauri\target\release\mymdnotepad.exe"),
  [int]$Runs = 5,
  [int]$TimeoutSec = 30
)
$ErrorActionPreference = "Stop"
$Exe = (Resolve-Path $Exe).Path
$work = Join-Path $env:TEMP ("mymdnotepad-measure-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$notes = Join-Path $work "notes"
$bin = Join-Path $work "bin"
New-Item -ItemType Directory -Force $notes, $bin | Out-Null
Copy-Item $Exe (Join-Path $bin "mymdnotepad.exe")

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

# v2 : 5 schémas mermaid (un par type de l'atelier + un diagramme de séquence), 5 alertes, du texte surligné.
$fence = '`' * 3
$diagrams = @(
  "pie title Temps passé`n    `"Dév`" : 60`n    `"Réunions`" : 25`n    `"Mails`" : 15",
  "flowchart TD`n    n1[`"Idée`"]`n    n2{`"Validée ?`"}`n    n3(`"Abandon`")`n    n1 --> n2`n    n2 -->|`"non`"| n3",
  "stateDiagram-v2`n    state `"Idle`" as s1`n    state `"Done`" as s2`n    [*] --> s1`n    s1 --> s2 : go`n    s2 --> [*]",
  "gantt`n    title Projet`n    dateFormat YYYY-MM-DD`n    section Conception`n    Maquettes :t1, 2026-10-26, 3d`n    Specs :t2, after t1, 2d",
  "sequenceDiagram`n    Alice->>Bob: Bonjour`n    Bob-->>Alice: Salut"
)
foreach ($d in $diagrams) {
  [void]$sb.AppendLine()
  [void]$sb.AppendLine($fence + "mermaid")
  [void]$sb.AppendLine($d)
  [void]$sb.AppendLine($fence)
}
foreach ($kind in @("NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION")) {
  [void]$sb.AppendLine()
  [void]$sb.AppendLine("> [!$kind]")
  [void]$sb.AppendLine("> Une alerte $kind avec du **gras** et du ==texte surligné==.")
}
[void]$sb.AppendLine()
[void]$sb.AppendLine("Un paragraphe avec ==du texte surligné== et ==un autre passage== à la fin.")
[System.IO.File]::WriteAllText((Join-Path $notes "grosse-note.md"), $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
$lines = ($sb.ToString() -split "`n").Count
Write-Host "Note générée : $lines lignes dont un tableau de 50 lignes, 5 schémas mermaid, 5 alertes, du texte surligné"

$settings = @{
  root_dir = $notes
  open_tabs = @("grosse-note.md")
  active_tab = "grosse-note.md"
  recent_emojis = @()
} | ConvertTo-Json
$settingsPath = Join-Path $bin "mymdnotepad.settings.json"
$log = Join-Path $env:TEMP "mymdnotepad-startup.log"

$results = @()
for ($run = 1; $run -le $Runs; $run++) {
  [System.IO.File]::WriteAllText($settingsPath, $settings, (New-Object System.Text.UTF8Encoding($false)))
  if (Test-Path $log) { Remove-Item $log -Force }
  $p = Start-Process -FilePath (Join-Path $bin "mymdnotepad.exe") -PassThru
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

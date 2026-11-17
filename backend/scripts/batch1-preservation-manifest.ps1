param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$output = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $repository $OutputDirectory))
}
New-Item -ItemType Directory -Force -Path $output | Out-Null

function Get-Category([string]$Path) {
  $normalized = $Path.Replace('\', '/').ToLowerInvariant()
  if ($normalized -match '(^|/)(node_modules|\.venv[^/]*|venv|dist|build|coverage|test-results|playwright-report|\.pytest_cache|__pycache__)(/|$)' -or $normalized -match '\.(pyc|log|tmp)$') { return 'generated' }
  if ($normalized -match '^backend/database/integration-migrations/') { return 'migration' }
  if ($normalized -match '(^|/)(tests?|__tests__)(/|$)' -or $normalized -match '\.(spec|test)\.(ts|tsx|js|jsx|py)$') { return 'test' }
  if ($normalized -match '(^|/)docs?/' -or $normalized -match '\.(md|pdf)$') { return 'documentation' }
  if ($normalized -match '(^|/)(\.env($|\.)|.*\.(pem|key|p12|pfx|crt|dump|bak)$)' -or $normalized -match '(secret|credential|backup)') { return 'private-risk' }
  if ($normalized -match '\.(ts|tsx|js|jsx|cjs|mjs|py|sql|css|html)$') { return 'source' }
  if ($normalized -match '(^|/)(package(-lock)?\.json|pyproject\.toml|requirements.*\.txt|tsconfig.*\.json|vite\.config.*|eslint.*|\.gitignore)$') { return 'configuration' }
  return 'other'
}

function Get-OwnershipHint([string]$Path) {
  $normalized = $Path.Replace('\', '/').ToLowerInvariant()
  if ((Get-Category $Path) -eq 'generated') { return 'generated-artifact' }
  if ($normalized.StartsWith('intelligence/')) { return 'concurrent-intelligence-history-preserve' }
  if ($normalized -match 'reminder|202611160001|202611160009|202611160012') { return 'concurrent-reminders-history-preserve' }
  if ($normalized -match 'medicine-library|catalogue|pricing') { return 'concurrent-catalogue-history-preserve' }
  return 'unassigned-preserve'
}

Push-Location $repository
try {
  $branch = (git branch --show-current).Trim()
  $head = (git rev-parse HEAD).Trim()
  $rawStatus = @(git status --porcelain=v1 --untracked-files=all | Where-Object {
    $_ -notmatch 'backend/scripts/batch1-preservation-manifest\.ps1$' -and
    $_ -notmatch 'backend/docs/batch-1-evidence/'
  })
  $records = foreach ($line in $rawStatus) {
    if ($line.Length -lt 4) { continue }
    $status = $line.Substring(0, 2)
    $path = $line.Substring(3).Trim('"')
    $category = Get-Category $path
    $absolutePath = Join-Path $repository $path
    $size = $null
    $hash = $null
    if (Test-Path -LiteralPath $absolutePath -PathType Leaf) {
      $size = (Get-Item -LiteralPath $absolutePath).Length
      $isPrimaryTree = -not $path.Replace('\', '/').StartsWith('MedDecode-dev/')
      if ($isPrimaryTree -and $category -in @('migration', 'source', 'test', 'configuration', 'private-risk')) {
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $absolutePath).Hash
      }
    }
    [pscustomobject]@{
      status = $status
      path = $path
      category = $category
      ownership_hint = Get-OwnershipHint $path
      size_bytes = $size
      sha256 = $hash
    }
  }

  $manifestPath = Join-Path $output 'BATCH_1_PRESERVATION_MANIFEST.csv'
  $records | Export-Csv -NoTypeInformation -Encoding utf8 -LiteralPath $manifestPath
  $summary = [ordered]@{
    captured_utc = (Get-Date).ToUniversalTime().ToString('o')
    repository = $repository
    branch = $branch
    head = $head
    record_count = $records.Count
    status_counts = @($records | Group-Object status | Sort-Object Name | ForEach-Object { [ordered]@{ status = $_.Name; count = $_.Count } })
    category_counts = @($records | Group-Object category | Sort-Object Name | ForEach-Object { [ordered]@{ category = $_.Name; count = $_.Count } })
    ownership_hints = @($records | Group-Object ownership_hint | Sort-Object Name | ForEach-Object { [ordered]@{ hint = $_.Name; count = $_.Count } })
    hashed_records = @($records | Where-Object sha256).Count
    note = 'Captured before Batch 1 code edits. The generator and output artifacts were created after the initial status count and are not members of that snapshot.'
  }
  $summary | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $output 'BATCH_1_PRESERVATION_SUMMARY.json')
  $summary | ConvertTo-Json -Depth 6
} finally {
  Pop-Location
}

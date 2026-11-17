[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('Initialize','ReplaceAws','Remove')][string]$Action)
# Windows Export-Clixml protects SecureString with user-bound DPAPI. This file
# stores only existing credentials, never creates or rotates remote credentials.
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows user-bound credential protection is required.' }
. (Join-Path $PSScriptRoot 'scoped-worker-acl.ps1')
$directory = Join-Path $env:LOCALAPPDATA 'MedDecode\ScopedWorkerCredentials'
$path = Join-Path $directory 'credentials.xml'
if ($Action -eq 'ReplaceAws') {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Protected credential store is unavailable.' }
  Assert-ScopedCredentialDacl $directory $true
  Assert-ScopedCredentialDacl $path $false
  $existing = @(Import-Clixml -LiteralPath $path)
  $required = @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','SCOPED_POSTGRES_PASSWORD','CATALOGUE_POSTGRES_PASSWORD')
  if (($existing.Count -ne 4 -and $existing.Count -ne 5) -or
      @($existing | Where-Object { $_ -isnot [pscredential] -or $_.UserName -notin ($required + 'AWS_SESSION_TOKEN') }).Count -ne 0) {
    throw 'Protected credential store is invalid; nothing was changed.'
  }
  foreach ($name in $required) { if (@($existing | Where-Object UserName -CEQ $name).Count -ne 1) { throw 'Protected credential store is incomplete; nothing was changed.' } }
  if (@($existing | Where-Object UserName -CEQ 'AWS_SESSION_TOKEN').Count -gt 1) { throw 'Protected credential store is invalid; nothing was changed.' }
  $replacement = @($existing | Where-Object { $_.UserName -in @('SCOPED_POSTGRES_PASSWORD','CATALOGUE_POSTGRES_PASSWORD') })
  $newCredentials = @()
  $temp = Join-Path $directory ('credentials-' + [guid]::NewGuid().ToString('N') + '.tmp')
  try {
    foreach ($entry in @(@('Existing worker AWS access key ID','AWS_ACCESS_KEY_ID'),@('Existing worker AWS secret key','AWS_SECRET_ACCESS_KEY'))) {
      $secret = Read-Host ($entry[0] + ' (hidden)') -AsSecureString
      if (-not $secret -or $secret.Length -eq 0) { throw 'AWS credentials missing; nothing was changed.' }
      $newCredentials += [pscredential]::new($entry[1], $secret)
    }
    $tokenChoice = Read-Host 'Are these temporary AWS credentials requiring a session token? Type yes or no'
    if ($tokenChoice -notin @('yes','no')) { throw 'Answer yes or no; nothing was changed.' }
    if ($tokenChoice -eq 'yes') {
      $token = Read-Host 'Existing AWS session token (hidden)' -AsSecureString
      if (-not $token -or $token.Length -eq 0) { throw 'AWS session token missing; nothing was changed.' }
      $newCredentials += [pscredential]::new('AWS_SESSION_TOKEN', $token)
    }
    $stream = [IO.File]::Open($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $stream.Close()
    Assert-ScopedCredentialDacl $temp $false
    @($replacement + $newCredentials) | Export-Clixml -LiteralPath $temp -Force
    Assert-ScopedCredentialDacl $temp $false
    $check = @(Import-Clixml -LiteralPath $temp)
    foreach ($name in @('SCOPED_POSTGRES_PASSWORD','CATALOGUE_POSTGRES_PASSWORD')) {
      $old = @($existing | Where-Object UserName -CEQ $name)[0].GetNetworkCredential().Password
      $new = @($check | Where-Object UserName -CEQ $name)[0].GetNetworkCredential().Password
      if ($old -cne $new) { throw 'PostgreSQL credential preservation failed; nothing was changed.' }
    }
    # Invoke the overload via reflection so Windows PowerShell 5.1 preserves a
    # null backup path rather than coercing it into an invalid empty string.
    $replace = [IO.File].GetMethod('Replace', [type[]]@([string],[string],[string],[bool]))
    $replaceArgs = New-Object 'object[]' 4
    $replaceArgs[0] = [string]$temp; $replaceArgs[1] = [string]$path
    $replaceArgs[2] = $null; $replaceArgs[3] = [bool]$true
    [void]$replace.Invoke($null, $replaceArgs)
    Assert-ScopedCredentialDacl $path $false
    'SCOPED_AWS_CREDENTIALS_REPLACED'
  } finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
    foreach ($credential in @($existing + $newCredentials)) { $credential.Password.Dispose() }
    Remove-Variable old,new,secret,token -ErrorAction SilentlyContinue
  }
  return
}
if ($Action -eq 'Remove') {
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Credential file is a reparse point.' }
    Remove-Item -LiteralPath $path -Force
    'SCOPED_CREDENTIAL_STORE_REMOVED'
  } else { 'SCOPED_CREDENTIAL_STORE_ABSENT' }
  return
}
if (Test-Path -LiteralPath $path) { throw 'Credential store exists; refusing to overwrite it.' }
if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
if ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Credential directory is a reparse point.' }
if (@(Get-ChildItem -LiteralPath $directory -Force).Count -ne 0) { throw 'Credential directory is not empty; refusing to modify its permissions.' }
Set-ScopedCredentialDirectoryDacl $directory
$credentials = @()
try {
  foreach ($spec in @(
    @('AWS worker access key ID','AWS_ACCESS_KEY_ID'),
    @('AWS worker secret key','AWS_SECRET_ACCESS_KEY'),
    @('Scoped PostgreSQL password','SCOPED_POSTGRES_PASSWORD'),
    @('Catalogue PostgreSQL password','CATALOGUE_POSTGRES_PASSWORD')
  )) {
    $stored = if ($spec[1] -in @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY')) {
      [Environment]::GetEnvironmentVariable($spec[1], 'Process')
    } elseif ($spec[1] -eq 'CATALOGUE_POSTGRES_PASSWORD' -and
      $env:MEDDECODE_CATALOGUE_USER -ceq 'meddecode_catalogue_python_reader.wyripeqruhvbksjfsvlr') {
      $env:MEDDECODE_CATALOGUE_PASSWORD
    } elseif ($spec[1] -eq 'SCOPED_POSTGRES_PASSWORD' -and $env:WORKER_DATABASE_URL) {
      try {
        $connection = [uri]$env:WORKER_DATABASE_URL
        $parts = $connection.UserInfo -split ':',2
        if ($connection.Scheme -in @('postgres','postgresql') -and $connection.Host -match '\.pooler\.supabase\.com$' -and
            $connection.Port -eq 5432 -and $connection.AbsolutePath -ceq '/postgres' -and -not $connection.Query -and
            $parts.Count -eq 2 -and [uri]::UnescapeDataString($parts[0]) -ceq 'meddecode_scoped_worker_login.wyripeqruhvbksjfsvlr') {
          [uri]::UnescapeDataString($parts[1])
        }
      } catch { $null }
    } else { $null }
    if ($stored) { $secure = ConvertTo-SecureString $stored -AsPlainText -Force; $stored = $null }
    else { $secure = Read-Host ($spec[0] + ' (hidden)') -AsSecureString }
    if (-not $secure -or $secure.Length -eq 0) { throw 'A credential was not supplied; no credential store was written.' }
    $credentials += [pscredential]::new($spec[1], $secure)
  }
  if ($env:AWS_SESSION_TOKEN) {
    $credentials += [pscredential]::new('AWS_SESSION_TOKEN', (ConvertTo-SecureString $env:AWS_SESSION_TOKEN -AsPlainText -Force))
  }
  $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  $stream.Close()
  try {
    Assert-ScopedCredentialDacl $directory $true
    Assert-ScopedCredentialDacl $path $false
    $credentials | Export-Clixml -LiteralPath $path -Force
    Assert-ScopedCredentialDacl $path $false
  }
  catch { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue; throw 'Credential storage failed.' }
  'SCOPED_CREDENTIAL_STORE_CREATED'
} finally {
  foreach ($credential in $credentials) { $credential.Password.Dispose() }
  Remove-Variable stored,secure -ErrorAction SilentlyContinue
}

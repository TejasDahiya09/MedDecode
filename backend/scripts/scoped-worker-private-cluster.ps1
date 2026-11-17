[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('Initialize','Start','Stop')][string]$Action)
$ErrorActionPreference='Stop'
$root=Join-Path $env:USERPROFILE 'MedDecode-ScopedWorker-PG17-20261114'
$data=Join-Path $root 'data'
$passfile=Join-Path $root 'local-test.pgpass'
$pwfile=Join-Path $root 'initdb-password.tmp'
$bin='C:\Program Files\PostgreSQL\17\bin'
$port=55439
if ($Action -eq 'Initialize') {
  if (Test-Path -LiteralPath $root) { throw 'Test cluster directory already exists; refusing to overwrite.' }
  $probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'),$port)
  try { $probe.Start() } catch { throw 'Test cluster port is unavailable.' } finally { $probe.Stop() }
  New-Item -ItemType Directory -Path $root | Out-Null
  $acl=[Security.AccessControl.DirectorySecurity]::new(); $acl.SetAccessRuleProtection($true,$false)
  $flags=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl',$flags,'None','Allow'))
  Set-Acl -LiteralPath $root -AclObject $acl
  $adminSecret=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
  $deployerSecret=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
  $workerSecret=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
  try {
    [IO.File]::WriteAllText($pwfile,$adminSecret,[Text.UTF8Encoding]::new($false))
    & (Join-Path $bin 'initdb.exe') -D $data -U scoped_cluster_admin --pwfile=$pwfile --auth-host=scram-sha-256 --auth-local=scram-sha-256 --encoding=UTF8 --no-locale | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Private PostgreSQL initdb failed.' }
    [IO.File]::WriteAllLines($passfile,@("127.0.0.1:${port}:*:scoped_cluster_admin:$adminSecret","127.0.0.1:${port}:*:postgres:$deployerSecret","127.0.0.1:${port}:*:meddecode_scoped_login:$workerSecret"),[Text.UTF8Encoding]::new($false))
    $startArguments='-D "{0}" -l "{1}" -o "-h 127.0.0.1 -p {2}" start' -f $data,(Join-Path $root 'postgres.log'),$port
    $startProcess=Start-Process -FilePath (Join-Path $bin 'pg_ctl.exe') -ArgumentList $startArguments -PassThru
    Start-Sleep -Seconds 2
    $startProcess.Refresh()
    if ($startProcess.HasExited -and $startProcess.ExitCode -ne 0) { throw 'Private PostgreSQL startup failed.' }
    $ready=& (Join-Path $bin 'pg_isready.exe') -h 127.0.0.1 -p $port 2>$null
    if ($ready -notmatch 'accepting connections') { throw 'Private PostgreSQL did not become ready after startup.' }
    $env:PGPASSFILE=$passfile
    $roles="CREATE ROLE postgres LOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOINHERIT PASSWORD '$deployerSecret'; CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB; CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB; CREATE ROLE meddecode_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB; CREATE ROLE meddecode_scoped_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB; CREATE ROLE meddecode_scoped_login LOGIN NOINHERIT NOSUPERUSER NOCREATEROLE NOCREATEDB PASSWORD '$workerSecret'; GRANT meddecode_scoped_worker TO meddecode_scoped_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;"
    $roles | & (Join-Path $bin 'psql.exe') -X -w -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $port -U scoped_cluster_admin -d postgres
    if ($LASTEXITCODE -ne 0) { throw 'Private role provisioning failed.' }
    & (Join-Path $bin 'createdb.exe') -h 127.0.0.1 -p $port -U scoped_cluster_admin -O postgres scoped_worker_verify
    if ($LASTEXITCODE -ne 0) { throw 'Private test database creation failed.' }
    Write-Output "PRIVATE_CLUSTER_READY path=$root port=$port database=scoped_worker_verify"
    $global:LASTEXITCODE=0
    $global:LASTEXITCODE=0
  } finally { if (Test-Path -LiteralPath $pwfile) { Remove-Item -LiteralPath $pwfile -Force }; Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue }
} elseif ($Action -eq 'Start') {
  if (-not (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION')) -or -not (Test-Path -LiteralPath $passfile)) { throw 'Private cluster is incomplete.' }
  $ready=& (Join-Path $bin 'pg_isready.exe') -h 127.0.0.1 -p $port 2>$null
  if ($ready -match 'accepting connections') {
    & (Join-Path $bin 'pg_ctl.exe') -D $data status
    if ($LASTEXITCODE -ne 0) { throw 'A server is accepting connections, but it does not match the private cluster status.' }
    Write-Output "PRIVATE_CLUSTER_ALREADY_RUNNING path=$root port=$port"
    $global:LASTEXITCODE=0
    $global:LASTEXITCODE=0
    return
  }
  if (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port $port is owned by an unknown or unhealthy server." }
  $pidFile=Join-Path $data 'postmaster.pid'
  if (Test-Path -LiteralPath $pidFile) {
    $pidLines=Get-Content -LiteralPath $pidFile
    $postmasterPid=0
    if ($pidLines.Count -lt 4 -or -not [int]::TryParse($pidLines[0],[ref]$postmasterPid)) {
      throw 'The cluster PID file is incomplete or malformed; refusing to remove it.'
    }
    $recordedData=[IO.Path]::GetFullPath($pidLines[1]).TrimEnd('\')
    $expectedData=[IO.Path]::GetFullPath($data).TrimEnd('\')
    $recordedPort=0
    if ($recordedData -ine $expectedData -or -not [int]::TryParse($pidLines[3],[ref]$recordedPort) -or $recordedPort -ne $port) {
      throw 'The cluster PID file does not identify this exact data directory and port; refusing to remove it.'
    }
    if (Get-Process -Id $postmasterPid -ErrorAction SilentlyContinue) { throw "The cluster PID file names active process $postmasterPid; refusing to remove it." }
    if (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue) { throw "Port $port is owned; refusing to remove the cluster PID file." }
    & (Join-Path $bin 'pg_ctl.exe') -D $data status 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { throw 'pg_ctl reports a running server; refusing to remove the cluster PID file.' }
    Remove-Item -LiteralPath $pidFile -Force
    Write-Output "REMOVED_VERIFIED_STALE_PID_FILE pid=$postmasterPid data_directory=$expectedData port=$port"
  }
  $startArguments='-D "{0}" -l "{1}" -o "-h 127.0.0.1 -p {2}" start' -f $data,(Join-Path $root 'postgres.log'),$port
  $startProcess=Start-Process -FilePath (Join-Path $bin 'pg_ctl.exe') -ArgumentList $startArguments -PassThru
  Start-Sleep -Seconds 2
  $startProcess.Refresh()
  if ($startProcess.HasExited -and $startProcess.ExitCode -ne 0) { throw 'Private PostgreSQL startup failed.' }
  $ready=& (Join-Path $bin 'pg_isready.exe') -h 127.0.0.1 -p $port 2>$null
  if ($ready -notmatch 'accepting connections') { throw 'Private PostgreSQL did not become ready after startup.' }
  & (Join-Path $bin 'pg_ctl.exe') -D $data status
  if ($LASTEXITCODE -ne 0) { throw 'Private PostgreSQL started but its data-directory status could not be verified.' }
  Write-Output "PRIVATE_CLUSTER_STARTED path=$root port=$port"
  $global:LASTEXITCODE=0
  $global:LASTEXITCODE=0
} else {
  if (-not (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION'))) { throw 'Private cluster identity is unavailable.' }
  & (Join-Path $bin 'pg_ctl.exe') -D $data status 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Output "PRIVATE_CLUSTER_ALREADY_STOPPED path=$root port=$port"
    $global:LASTEXITCODE=0
    $global:LASTEXITCODE=0
    return
  }
  $stopArguments='-D "{0}" -m smart -w -t 60 stop' -f $data
  $stopProcess=Start-Process -FilePath (Join-Path $bin 'pg_ctl.exe') -ArgumentList $stopArguments -PassThru
  $stopProcess.WaitForExit()
  if ($stopProcess.ExitCode -ne 0) { throw 'Private PostgreSQL shutdown failed.' }
  $ready=& (Join-Path $bin 'pg_isready.exe') -h 127.0.0.1 -p $port 2>$null
  if ($ready -match 'accepting connections') { throw 'Private PostgreSQL still accepts connections after shutdown.' }
  Write-Output "PRIVATE_CLUSTER_STOPPED path=$root port=$port"
  $global:LASTEXITCODE=0
  $global:LASTEXITCODE=0
}

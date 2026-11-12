$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'harness-safety.psm1') -Force

function Expect-Rejection {
  param([scriptblock]$Action, [string]$Name)
  try {
    & $Action
  } catch {
    Write-Output "PASS $Name"
    return
  }
  throw "Safety test did not reject: $Name"
}

$approved = 'postgresql://postgres@127.0.0.1:5433/meddecode_job_test'
Expect-Rejection { Assert-ApprovedWorkerTestTarget $approved $false } 'missing approval'
Expect-Rejection {
  Assert-ApprovedWorkerTestTarget 'postgresql://postgres@localhost:5433/meddecode_job_test' $true
} 'wrong hostname'
Expect-Rejection {
  Assert-ApprovedWorkerTestTarget 'postgresql://postgres@127.0.0.1:5432/meddecode_job_test' $true
} 'wrong port'
Expect-Rejection {
  Assert-ApprovedWorkerTestTarget 'postgresql://postgres@127.0.0.1:5433/other' $true
} 'wrong database'
Expect-Rejection {
  Assert-WorkerTestPreflightMarker 'WRONG_IDENTITY' 'IDENTITY_OK'
} 'failed identity verification'
Expect-Rejection {
  Assert-WorkerTestPreflightMarker 'UNEXPECTED_OBJECTS' 'RESET_INVENTORY_OK'
} 'unexpected inventory'

$result = Assert-ApprovedWorkerTestTarget $approved $true
if ($result.Host -cne '127.0.0.1' -or $result.Port -ne 5433) {
  throw 'Approved target was parsed incorrectly.'
}
Assert-WorkerTestPreflightMarker 'IDENTITY_OK' 'IDENTITY_OK'
Assert-WorkerTestPreflightMarker 'RESET_INVENTORY_OK' 'RESET_INVENTORY_OK'
Write-Output 'Non-destructive worker harness safety tests passed.'

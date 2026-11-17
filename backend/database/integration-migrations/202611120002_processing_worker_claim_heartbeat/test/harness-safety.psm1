function Assert-ApprovedWorkerTestTarget {
  param(
    [Parameter(Mandatory = $true)][string]$DatabaseUrl,
    [Parameter(Mandatory = $true)][bool]$ResetApproved
  )
  if (-not $ResetApproved) {
    throw 'Explicit -ApproveDisposableReset approval is required.'
  }
  $uri = [Uri]$DatabaseUrl
  if ($uri.Scheme -notin @('postgres', 'postgresql') -or
      $uri.Host -cne '127.0.0.1' -or
      $uri.Port -ne 5433 -or
      $uri.AbsolutePath -cne '/meddecode_job_test' -or
      $uri.UserInfo -cne 'postgres' -or
      -not [string]::IsNullOrEmpty($uri.Query) -or
      -not [string]::IsNullOrEmpty($uri.Fragment)) {
    throw 'Only postgresql://postgres@127.0.0.1:5433/meddecode_job_test is allowed.'
  }
  return $uri
}

function Assert-WorkerTestPreflightMarker {
  param(
    [Parameter(Mandatory = $true)][string]$Output,
    [Parameter(Mandatory = $true)][ValidateSet('IDENTITY_OK','RESET_INVENTORY_OK')]
    [string]$Expected
  )
  $lines = @($Output -split "`r?`n" | ForEach-Object { $_.Trim() } |
    Where-Object { $_ -ne '' })
  if ($lines.Count -ne 1 -or $lines[0] -cne $Expected) {
    throw "Read-only preflight did not return the exact $Expected marker."
  }
}

Export-ModuleMember -Function Assert-ApprovedWorkerTestTarget,Assert-WorkerTestPreflightMarker

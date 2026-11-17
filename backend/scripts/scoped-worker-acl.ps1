# DACL-only helpers: never request or write audit/SACL security information.
function Assert-ScopedCredentialDacl([string]$Path, [bool]$IsDirectory) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Credential path is a reparse point.' }
  $section = [Security.AccessControl.AccessControlSections]::Access
  $acl = if ($IsDirectory) { [IO.Directory]::GetAccessControl($Path, $section) } else { [IO.File]::GetAccessControl($Path, $section) }
  if ($IsDirectory -and -not $acl.AreAccessRulesProtected) { throw 'Credential directory DACL inheritance is not protected.' }
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $system = 'S-1-5-18'
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 2) { throw 'Credential path has unexpected access rules.' }
  foreach ($sid in @($user, $system)) {
    $matches = @($rules | Where-Object { $_.IdentityReference.Value -ceq $sid -and $_.AccessControlType -eq 'Allow' })
    if ($matches.Count -ne 1 -or ($matches[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl) {
      throw 'Credential path lacks its required restricted DACL.'
    }
    if ($IsDirectory -and (($matches[0].InheritanceFlags -band ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit)) -ne ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit))) {
      throw 'Credential directory permissions do not propagate to its file.'
    }
  }
}

function Set-ScopedCredentialDirectoryDacl([string]$Path) {
  $section = [Security.AccessControl.AccessControlSections]::Access
  $acl = [IO.Directory]::GetAccessControl($Path, $section)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  $flags = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
  foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $flags, 'None', 'Allow'))
  }
  [IO.Directory]::SetAccessControl($Path, $acl)
  Assert-ScopedCredentialDacl $Path $true
}

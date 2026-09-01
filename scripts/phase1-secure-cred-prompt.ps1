# Secure credential dialog — does not echo secrets to the console.
# Writes a short-lived ACL-restricted temp file path for the Node test runner, then exits.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/phase1-secure-cred-prompt.ps1 -OutFile <path> [-Mode owner|staff|both]

param(
  [Parameter(Mandatory = $true)][string]$OutFile,
  [ValidateSet('owner','staff','both')][string]$Mode = 'both'
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Shop POS — Secure Test Credentials'
$form.Size = New-Object System.Drawing.Size(460, 420)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$y = 16
function Add-Label([string]$text) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text
  $l.Location = New-Object System.Drawing.Point(20, $script:y)
  $l.Size = New-Object System.Drawing.Size(400, 18)
  $form.Controls.Add($l)
  $script:y += 20
}
function Add-Box([bool]$password = $false, [string]$default = '') {
  $t = New-Object System.Windows.Forms.TextBox
  $t.Location = New-Object System.Drawing.Point(20, $script:y)
  $t.Size = New-Object System.Drawing.Size(400, 24)
  if ($password) { $t.UseSystemPasswordChar = $true }
  if ($default) { $t.Text = $default }
  $form.Controls.Add($t)
  $script:y += 34
  return $t
}

$info = New-Object System.Windows.Forms.Label
$info.Text = "Credentials stay on this PC only. They are not saved to the project, .env, Git, or the test report."
$info.Location = New-Object System.Drawing.Point(20, $y)
$info.Size = New-Object System.Drawing.Size(400, 40)
$form.Controls.Add($info)
$y += 48

$ownerUser = $null; $ownerPass = $null; $ownerPin = $null
$staffCode = $null; $staffPin = $null

if ($Mode -eq 'owner' -or $Mode -eq 'both') {
  Add-Label 'Owner username'
  $ownerUser = Add-Box $false 'chisa96'
  Add-Label 'Owner password'
  $ownerPass = Add-Box $true
  Add-Label 'Owner PIN (optional — leave blank if none)'
  $ownerPin = Add-Box $true
}

if ($Mode -eq 'staff' -or $Mode -eq 'both') {
  Add-Label 'Staff Portal employee ID / code'
  $staffCode = Add-Box $false
  Add-Label 'Staff Portal PIN'
  $staffPin = Add-Box $true
}

$ok = New-Object System.Windows.Forms.Button
$ok.Text = 'Continue tests'
$ok.Location = New-Object System.Drawing.Point(220, ($y + 10))
$ok.Size = New-Object System.Drawing.Size(120, 32)
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.Add($ok)
$form.AcceptButton = $ok

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.Location = New-Object System.Drawing.Point(100, ($y + 10))
$cancel.Size = New-Object System.Drawing.Size(100, 32)
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($cancel)
$form.CancelButton = $cancel

$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  exit 2
}

$payload = @{
  collectedAt = (Get-Date).ToUniversalTime().ToString('o')
  owner = $null
  staff = $null
}

if ($ownerUser) {
  $payload.owner = @{
    username = $ownerUser.Text.Trim()
    password = $ownerPass.Text
    pin = $ownerPin.Text
  }
}
if ($staffCode) {
  $payload.staff = @{
    code = $staffCode.Text.Trim()
    pin = $staffPin.Text
  }
}

$dir = Split-Path -Parent $OutFile
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

# Restrict ACL to current user before writing
$tmp = $OutFile + '.partial'
$json = $payload | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($tmp, $json)
$acl = Get-Acl $tmp
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
  [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
  'FullControl', 'Allow'
)
$acl.SetAccessRule($rule)
Set-Acl -Path $tmp -AclObject $acl
Move-Item -Force -Path $tmp -Destination $OutFile
# Print only the path (no secrets)
Write-Output $OutFile
exit 0

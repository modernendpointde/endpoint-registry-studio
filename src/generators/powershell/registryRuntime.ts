import type { RegistryMutationKind } from "../../domain/effectiveBehavior";

export const registryAccess = String.raw`function Open-RegistryBaseKey {
    param(
        [Microsoft.Win32.RegistryHive]$Hive,
        [Microsoft.Win32.RegistryView]$View
    )
    return [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, $View)
}`;

export function exactReadEngine(exactSequence: boolean): string {
  const sequence = exactSequence
    ? String.raw`
function Test-ExactSequence {
    param([object[]]$Actual, [object[]]$Expected)
    if ($Actual.Count -ne $Expected.Count) { return $false }
    for ($index = 0; $index -lt $Actual.Count; $index++) {
        if ($Actual[$index] -cne $Expected[$index]) { return $false }
    }
    return $true
}
`
    : "";
  const sequenceBranch = exactSequence
    ? String.raw`    if ($Entry.Sequence) {
        return Test-ExactSequence -Actual @($State.Value) -Expected @($Entry.Value)
    }
`
    : "";
  return String.raw`function Get-RegistryState {
    param(
        [System.Collections.IDictionary]$Entry,
        [Microsoft.Win32.RegistryView]$View
    )
    $baseKey = Open-RegistryBaseKey -Hive $Entry.Hive -View $View
    try {
        $key = $baseKey.OpenSubKey($Entry.KeyPath, $false)
        if ($null -eq $key) {
            return [ordered]@{
                KeyExists = $false
                KeyEmpty = $false
                ValueExists = $false
                Kind = $null
                Value = $null
            }
        }
        try {
            if ($Entry.Check -eq 'KeyAbsent') {
                return [ordered]@{
                    KeyExists = $true
                    KeyEmpty = ($key.SubKeyCount -eq 0 -and $key.ValueCount -eq 0)
                    ValueExists = $false
                    Kind = $null
                    Value = $null
                }
            }
            $exists = @($key.GetValueNames()) -contains [string]$Entry.ValueName
            if (-not $exists) {
                return [ordered]@{
                    KeyExists = $true
                    KeyEmpty = ($key.SubKeyCount -eq 0 -and $key.ValueCount -eq 0)
                    ValueExists = $false
                    Kind = $null
                    Value = $null
                }
            }
            return [ordered]@{
                KeyExists = $true
                KeyEmpty = $false
                ValueExists = $true
                Kind = $key.GetValueKind($Entry.ValueName)
                Value = $key.GetValue(
                    $Entry.ValueName,
                    $null,
                    [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
                )
            }
        } finally {
            $key.Dispose()
        }
    } finally {
        $baseKey.Dispose()
    }
}
${sequence}
function Test-RegistryExactState {
    param(
        [System.Collections.IDictionary]$Entry,
        [System.Collections.IDictionary]$State
    )
    if ($Entry.Check -eq 'KeyAbsent') { return -not $State.KeyExists }
    if ($Entry.Check -eq 'ValueAbsent') { return -not $State.ValueExists }
    if ($Entry.Check -eq 'KeyIfEmpty') {
        return ((-not $State.KeyExists) -or ((-not $State.ValueExists) -and (-not $State.KeyEmpty)))
    }
    if (-not $State.ValueExists) { return $false }
    if ($State.Kind -ne $Entry.Kind) { return $false }
${sequenceBranch}    return $State.Value -ceq $Entry.Value
}`;
}

export function dryRunDisplayEngine(): string {
  return String.raw`function Format-RegistryValue {
    param(
        [object]$Value,
        [Microsoft.Win32.RegistryValueKind]$Kind
    )
    if ($null -eq $Value) { return '(not present)' }
    if ($Kind -eq [Microsoft.Win32.RegistryValueKind]::MultiString) {
        return @($Value) -join ' | '
    }
    if ($Kind -eq [Microsoft.Win32.RegistryValueKind]::Binary) {
        return (@($Value) | ForEach-Object { ([byte]$_).ToString('X2') }) -join ' '
    }
    if ($Kind -eq [Microsoft.Win32.RegistryValueKind]::DWord) {
        return [BitConverter]::ToUInt32([BitConverter]::GetBytes([int32]$Value), 0).ToString(
            [Globalization.CultureInfo]::InvariantCulture
        )
    }
    if ($Kind -eq [Microsoft.Win32.RegistryValueKind]::QWord) {
        return [BitConverter]::ToUInt64([BitConverter]::GetBytes([int64]$Value), 0).ToString(
            [Globalization.CultureInfo]::InvariantCulture
        )
    }
    return [string]$Value
}`;
}

export function mutationEngine(actions: ReadonlySet<RegistryMutationKind>): string {
  const branches: string[] = [];
  if (actions.has("SetValue")) {
    branches.push(String.raw`        'SetValue' {
            $key = $baseKey.CreateSubKey($Entry.KeyPath, $true)
            try { $key.SetValue($Entry.ValueName, $Entry.Value, $Entry.Kind) }
            finally { $key.Dispose() }
            return
        }`);
  }
  if (actions.has("DeleteKeyRecursive")) {
    branches.push(String.raw`        'DeleteKeyRecursive' {
            $baseKey.DeleteSubKeyTree($Entry.KeyPath, $false)
            return
        }`);
  }
  if (actions.has("DeleteValue")) {
    branches.push(String.raw`        'DeleteValue' {
            $key = $baseKey.OpenSubKey($Entry.KeyPath, $true)
            if ($null -eq $key) { return }
            try { $key.DeleteValue($Entry.ValueName, $false) }
            finally { $key.Dispose() }
            return
        }`);
  }
  if (actions.has("DeleteValueAndEmptyKey")) {
    branches.push(String.raw`        'DeleteValueAndEmptyKey' {
            $key = $baseKey.OpenSubKey($Entry.KeyPath, $true)
            if ($null -eq $key) { return }
            try {
                $key.DeleteValue($Entry.ValueName, $false)
                $empty = $key.SubKeyCount -eq 0 -and $key.ValueCount -eq 0
            } finally {
                $key.Dispose()
            }
            if ($empty) { $baseKey.DeleteSubKey($Entry.KeyPath, $false) }
            return
        }`);
  }
  return String.raw`function Invoke-RegistryAction {
    param(
        [System.Collections.IDictionary]$Entry,
        [Microsoft.Win32.RegistryView]$View
    )
    $baseKey = Open-RegistryBaseKey -Hive $Entry.Hive -View $View
    try {
        switch ($Entry.Action) {
${branches.join("\n")}
        }
    } finally {
        $baseKey.Dispose()
    }
}`;
}

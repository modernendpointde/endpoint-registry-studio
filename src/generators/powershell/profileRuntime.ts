import type { ScriptFeatures } from "./types";

export function profileEngine(features: ScriptFeatures): string {
  if (!features.profileTargeting) return "";
  const needsSignedIn = features.profileTargets.has("AllSignedInUsers");
  const needsAllProfiles = features.profileTargets.has("AllExistingProfiles");

  const signedInFunction = needsSignedIn
    ? String.raw`
function Get-SignedInUserSids {
    $sids = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    try {
        $processes = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" -ErrorAction Stop)
    } catch {
        Add-ProfileResolutionError -Message (
            "Could not enumerate signed-in users: $($_.Exception.Message)"
        )
        return @()
    }
    foreach ($process in $processes) {
        try {
            $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner -ErrorAction Stop
            if ($owner.ReturnValue -ne 0 -or [string]::IsNullOrWhiteSpace($owner.User)) { continue }
            $account = if ($owner.Domain) { "$($owner.Domain)\$($owner.User)" } else { $owner.User }
            $sid = ([System.Security.Principal.NTAccount]$account).Translate(
                [System.Security.Principal.SecurityIdentifier]
            ).Value
            if (Test-IsUserSid -Sid $sid) { [void]$sids.Add($sid) }
        } catch {
            Add-ProfileResolutionError -Message (
                "Could not resolve an interactive Explorer owner: $($_.Exception.Message)"
            )
        }
    }
    return @($sids)
}
`
    : "";

  const allProfilesFunction = needsAllProfiles
    ? String.raw`
function Get-AllProfileRecords {
    $records = [System.Collections.Generic.List[object]]::new()
    $profileBase = $null
    $profileList = $null
    try {
        $profileBase = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
            [Microsoft.Win32.RegistryHive]::LocalMachine,
            [Microsoft.Win32.RegistryView]::Registry64
        )
        $profileList = $profileBase.OpenSubKey(
            'SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList',
            $false
        )
        if ($null -eq $profileList) {
            Add-ProfileResolutionError -Message 'The 64-bit ProfileList key is unavailable.'
            return @()
        }
        foreach ($sid in @($profileList.GetSubKeyNames())) {
            if (-not (Test-IsUserSid -Sid $sid)) { continue }
            try {
                $record = Get-ProfileRecord -Sid $sid
                if ($null -ne $record) { $records.Add($record) }
            } catch {
                Add-ProfileResolutionError -Message (
                    "Could not inspect profile $($sid): $($_.Exception.Message)"
                )
            }
        }
    } catch {
        Add-ProfileResolutionError -Message (
            "Could not enumerate existing profiles: $($_.Exception.Message)"
        )
    } finally {
        if ($null -ne $profileList) { $profileList.Dispose() }
        if ($null -ne $profileBase) { $profileBase.Dispose() }
    }
    return @($records)
}
`
    : "";

  const initializePlans: string[] = [];
  if (needsAllProfiles) {
    initializePlans.push(String.raw`    $allProfiles = @(Get-AllProfileRecords)
    if ($allProfiles.Count -eq 0) {
        Add-ProfileResolutionError -Message 'No applicable profiles were found for AllExistingProfiles.'
    }
    $script:ProfileTargetPlans['AllExistingProfiles'] = $allProfiles`);
  }
  if (needsSignedIn) {
    initializePlans.push(String.raw`    $signedInProfiles = [System.Collections.Generic.List[object]]::new()
    foreach ($sid in @(Get-SignedInUserSids)) {
        try {
            $record = Get-ProfileRecord -Sid $sid
            if ($null -ne $record) { $signedInProfiles.Add($record) }
        } catch {
            Add-ProfileResolutionError -Message (
                "Could not inspect signed-in profile $($sid): $($_.Exception.Message)"
            )
        }
    }
    if ($signedInProfiles.Count -eq 0) {
        Add-ProfileResolutionError -Message 'No applicable profiles were found for AllSignedInUsers.'
    }
    $script:ProfileTargetPlans['AllSignedInUsers'] = @($signedInProfiles)`);
  }
  if (features.includeDefaultUser) {
    initializePlans.push(String.raw`    $defaultProfile = [ordered]@{
        Sid = 'DefaultUser'
        Username = 'Default User'
        ProfilePath = (Join-Path $env:SystemDrive 'Users\Default')
    }
    $script:ProfileRecords['DefaultUser'] = $defaultProfile
    $script:ProfileTargetPlans['DefaultUser'] = @($defaultProfile)`);
  }

  const defaultSelection = features.includeDefaultUser
    ? String.raw`
        if ($source.IncludeDefaultUser) {
            $targets += @($script:ProfileTargetPlans['DefaultUser'])
        }`
    : "";

  return String.raw`$script:SelfLoadedHives = [System.Collections.Generic.List[string]]::new()
$script:ProfileRecords = @{}
$script:PreparedProfiles = @{}
$script:ProfileTargetPlans = @{}
$script:ProfileResolutionErrors = 0
$script:ProfileCleanupErrors = 0
$script:ProfileResolutionMessages = [System.Collections.Generic.List[string]]::new()

function Add-ProfileResolutionError {
    param([string]$Message)
    $script:ProfileResolutionErrors++
    $script:ProfileResolutionMessages.Add("PROFILE-ERROR: $Message")
}

function Test-IsUserSid {
    param([string]$Sid)
    return $Sid -match '^S-\d-\d+(?:-\d+)+$' -and $Sid -notmatch '^S-1-5-(?:18|19|20)$'
}

function Get-ProfileRecord {
    param([string]$Sid)
    if (-not (Test-IsUserSid -Sid $Sid)) { return $null }
    if ($script:ProfileRecords.ContainsKey($Sid)) {
        return $script:ProfileRecords[$Sid]
    }

    $record = $null
    $profileBase = $null
    $profileKey = $null
    try {
        $profileBase = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
            [Microsoft.Win32.RegistryHive]::LocalMachine,
            [Microsoft.Win32.RegistryView]::Registry64
        )
        $profileKey = $profileBase.OpenSubKey(
            "SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$Sid",
            $false
        )
        if ($null -eq $profileKey) {
            Add-ProfileResolutionError -Message "ProfileList has no record for $Sid."
            $script:ProfileRecords[$Sid] = $null
            return $null
        }
        $path = [Environment]::ExpandEnvironmentVariables(
            [string]$profileKey.GetValue('ProfileImagePath', '')
        )
        if ([string]::IsNullOrWhiteSpace($path)) {
            Add-ProfileResolutionError -Message "Profile $Sid has no usable ProfileImagePath."
            $script:ProfileRecords[$Sid] = $null
            return $null
        }
        if ($path -match '(?i)\\Windows\\(?:System32\\config\\systemprofile|ServiceProfiles)(?:\\|$)') {
            $script:ProfileRecords[$Sid] = $null
            return $null
        }
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            Add-ProfileResolutionError -Message (
                "Profile $Sid path is missing or inaccessible: $path"
            )
            $script:ProfileRecords[$Sid] = $null
            return $null
        }
        $record = [ordered]@{
            Sid = $Sid
            Username = (Split-Path -Leaf $path)
            ProfilePath = $path
        }
        $script:ProfileRecords[$Sid] = $record
        return $record
    } catch {
        Add-ProfileResolutionError -Message (
            "Could not resolve profile $($Sid): $($_.Exception.Message)"
        )
        $script:ProfileRecords[$Sid] = $null
        return $null
    } finally {
        if ($null -ne $profileKey) { $profileKey.Dispose() }
        if ($null -ne $profileBase) { $profileBase.Dispose() }
    }
}
${signedInFunction}${allProfilesFunction}
function Test-IsProfileHiveLoaded {
    param([string]$Sid)
    $users = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::Users,
        [Microsoft.Win32.RegistryView]::Default
    )
    try {
        $key = $users.OpenSubKey($Sid, $false)
        if ($null -eq $key) { return $false }
        $key.Dispose()
        return $true
    } finally {
        $users.Dispose()
    }
}

function Prepare-ProfileHive {
    param([System.Collections.IDictionary]$Profile)
    if ($script:PreparedProfiles.ContainsKey($Profile.Sid)) {
        return $script:PreparedProfiles[$Profile.Sid]
    }

    $Profile['Mount'] = $null
    $Profile['AlreadyLoaded'] = $false
    $Profile['LoadedByScript'] = $false
    $Profile['Error'] = $null
    try {
        if (Test-IsProfileHiveLoaded -Sid $Profile.Sid) {
            $Profile.Mount = $Profile.Sid
            $Profile.AlreadyLoaded = $true
        } else {
            $ntUserPath = Join-Path $Profile.ProfilePath 'NTUSER.DAT'
            if (-not (Test-Path -LiteralPath $ntUserPath -PathType Leaf)) {
                throw "NTUSER.DAT is missing for $($Profile.Username) [$($Profile.Sid)] at $ntUserPath."
            }
            $mount = "ERS_$($PackageFingerprint)_$([Guid]::NewGuid().ToString('N'))"
            & reg.exe load "HKU\$mount" $ntUserPath | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "Could not load $ntUserPath for $($Profile.Sid) (reg.exe exit $LASTEXITCODE)."
            }
            $script:SelfLoadedHives.Add($mount)
            $Profile.Mount = $mount
            $Profile.LoadedByScript = $true
        }
    } catch {
        $Profile.Error = $_.Exception.Message
        Add-ProfileResolutionError -Message (
            "username=$($Profile.Username) sid=$($Profile.Sid) " +
            "path=$($Profile.ProfilePath): $($Profile.Error)"
        )
    }
    $script:PreparedProfiles[$Profile.Sid] = $Profile
    return $Profile
}

function Initialize-ProfileTargetPlans {
${initializePlans.join("\n")}

    $uniqueProfiles = @{}
    foreach ($planName in @($script:ProfileTargetPlans.Keys)) {
        foreach ($profile in @($script:ProfileTargetPlans[$planName])) {
            $uniqueProfiles[$profile.Sid] = $profile
        }
    }
    foreach ($profile in @($uniqueProfiles.Values)) {
        [void](Prepare-ProfileHive -Profile $profile)
    }
}

function Expand-RegistryEntriesForProfiles {
    param([object[]]$SourceEntries)
    $expanded = [System.Collections.Generic.List[object]]::new()
    foreach ($source in $SourceEntries) {
        if ($source.Hive -ne [Microsoft.Win32.RegistryHive]::CurrentUser) {
            $expanded.Add($source)
            continue
        }

        $targets = @($script:ProfileTargetPlans[$source.UserHiveTarget])${defaultSelection}
        foreach ($profile in $targets) {
            if ($null -ne $profile.Error) { continue }
            try {
                $copy = [ordered]@{}
                foreach ($key in $source.Keys) { $copy[$key] = $source[$key] }
                $copy.Hive = [Microsoft.Win32.RegistryHive]::Users
                $copy.HiveLabel = 'HKEY_USERS'
                $copy.KeyPath = "$($profile.Mount)\$($source.KeyPath)"
                $copy.TargetSid = $profile.Sid
                $copy.TargetUsername = $profile.Username
                $copy.TargetProfilePath = $profile.ProfilePath
                $copy.HiveWasLoaded = $profile.AlreadyLoaded
                $expanded.Add($copy)
            } catch {
                Add-ProfileResolutionError -Message (
                    "Could not expand item $($source.Id) for $($profile.Sid): $($_.Exception.Message)"
                )
            }
        }
    }
    return @($expanded)
}

function Close-SelfLoadedProfileHives {
    for ($index = $script:SelfLoadedHives.Count - 1; $index -ge 0; $index--) {
        $mount = $script:SelfLoadedHives[$index]
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
        try {
            & reg.exe unload "HKU\$mount" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "reg.exe exit $LASTEXITCODE" }
        } catch {
            $script:ProfileCleanupErrors++
            $script:ProfileResolutionMessages.Add(
                "PROFILE-ERROR: Could not unload self-loaded hive HKU\${mount}: $($_.Exception.Message)"
            )
        }
    }
    $script:SelfLoadedHives.Clear()
    $script:PreparedProfiles.Clear()
}`;
}

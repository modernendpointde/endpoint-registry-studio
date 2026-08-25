import type { ScriptKind } from "./types";

interface RoleBody {
  execute: string;
  finalize: string;
}

function profileErrorInitializer(profileTargeting: boolean): string {
  return profileTargeting ? "$script:ProfileResolutionErrors" : "0";
}

function profileCleanupResult(profileTargeting: boolean): string {
  return profileTargeting ? "$errors += $script:ProfileCleanupErrors\n" : "";
}

function profileMessages(profileTargeting: boolean): string {
  return profileTargeting ? "$script:ProfileResolutionMessages | Write-Output\n" : "";
}

export function ersRoleName(kind: ScriptKind): string {
  return kind === "Win32Detect" ? "Detect" : kind;
}

function detectSummary(profileTargeting: boolean): string {
  return profileTargeting
    ? 'Write-Output "ERS; fingerprint=$PackageFingerprint; role=Detect; Profiles=$profiles; Compliant=$compliant; NonCompliant=$nonCompliant; Errors=$errors"'
    : 'Write-Output "ERS; fingerprint=$PackageFingerprint; role=Detect; Compliant=$compliant; NonCompliant=$nonCompliant; Errors=$errors"';
}

export function detectBody(kind: "Detect" | "Win32Detect", profileTargeting: boolean): RoleBody {
  const installed = kind === "Win32Detect";
  const compliantLabel = installed ? "INSTALLED" : "COMPLIANT";
  const nonCompliantLabel = installed ? "NOT-INSTALLED" : "NON-COMPLIANT";
  const exitCode = installed
    ? "$exitCode = if ($errors -gt 0) { 2 } elseif ($nonCompliant -gt 0) { 1 } else { 0 }"
    : "$exitCode = if ($nonCompliant -gt 0 -or $errors -gt 0) { 1 } else { 0 }";
  const profiles = profileTargeting
    ? "$profiles = @($entries | ForEach-Object { $_.TargetSid } | Where-Object { $_ } | Select-Object -Unique).Count\n"
    : "";
  return {
    execute: String.raw`$compliant = 0
$nonCompliant = 0
$errors = ${profileErrorInitializer(profileTargeting)}
$details = [System.Collections.Generic.List[string]]::new()
foreach ($entry in $entries) {
    foreach ($view in $entry.Views) {
        try {
            $state = Get-RegistryState -Entry $entry -View $view.Value
            if (Test-RegistryExactState -Entry $entry -State $state) {
                $compliant++
                $details.Add("${compliantLabel} [$($view.Label)] $($entry.HiveLabel)\$($entry.KeyPath) :: $($entry.ValueName)")
            } else {
                $nonCompliant++
                $details.Add("${nonCompliantLabel} [$($view.Label)] $($entry.HiveLabel)\$($entry.KeyPath) :: $($entry.ValueName)")
            }
        } catch {
            $errors++
            $details.Add("${installed ? "DETECTION-ERROR" : "ERROR"} [$($view.Label)] $($entry.Id): $($_.Exception.Message)")
        }
    }
}`,
    finalize: String.raw`${profileCleanupResult(profileTargeting)}${profiles}${detectSummary(profileTargeting)}
${profileMessages(profileTargeting)}$details | Write-Output
${exitCode}`,
  };
}

export function mutationBody(
  kind: ScriptKind,
  profileTargeting: boolean,
  writeDeviceLog: boolean,
): RoleBody {
  const role = ersRoleName(kind);
  const deviceLog = writeDeviceLog
    ? `\nWrite-ErsDeviceMark "fingerprint=$PackageFingerprint role=${role} processed=$processed errors=$errors"`
    : "";
  return {
    execute: String.raw`$processed = 0
$errors = ${profileErrorInitializer(profileTargeting)}
$details = [System.Collections.Generic.List[string]]::new()
foreach ($entry in $entries) {
    foreach ($view in $entry.Views) {
        try {
            Invoke-RegistryAction -Entry $entry -View $view.Value
            $processed++
        } catch {
            $errors++
            $details.Add("ERROR [$($view.Label)] $($entry.Id): $($_.Exception.Message)")
        }
    }
}`,
    finalize: String.raw`${profileCleanupResult(profileTargeting)}Write-Output "ERS; fingerprint=$PackageFingerprint; role=${role}; processed=$processed; errors=$errors"${deviceLog}
${profileMessages(profileTargeting)}$details | Write-Output
$exitCode = if ($errors -gt 0) { 1 } else { 0 }`,
  };
}

export function dryRunBody(profileTargeting: boolean): RoleBody {
  return {
    execute: String.raw`$total = 0
$compliant = 0
$nonCompliant = 0
$errors = ${profileErrorInitializer(profileTargeting)}
$details = [System.Collections.Generic.List[string]]::new()
foreach ($entry in $entries) {
    foreach ($view in $entry.Views) {
        $total++
        try {
            $state = Get-RegistryState -Entry $entry -View $view.Value
            $isCompliant = Test-RegistryExactState -Entry $entry -State $state
            if ($isCompliant) { $compliant++ } else { $nonCompliant++ }
            $currentType = if ($state.ValueExists) { $state.Kind.ToString() } else { '(not present)' }
            $currentValue = if ($state.ValueExists) {
                Format-RegistryValue -Value $state.Value -Kind $state.Kind
            } else {
                '(not present)'
            }
            $details.Add("DRY-RUN [$($view.Label)] $($entry.HiveLabel)\$($entry.KeyPath) :: $($entry.ValueName)")
            if ($entry.TargetSid) {
                $details.Add("  Username: $($entry.TargetUsername)")
                $details.Add("  SID: $($entry.TargetSid)")
                $details.Add("  Profile path: $($entry.TargetProfilePath)")
                $details.Add("  Hive already loaded: $($entry.HiveWasLoaded)")
                $details.Add("  Effective Registry path: $($entry.HiveLabel)\$($entry.KeyPath)")
            }
            $details.Add("  Current value: $currentValue")
            $details.Add("  Current type: $currentType")
            $details.Add("  Expected value: $($entry.ExpectedDisplay)")
            $details.Add("  Expected type: $($entry.ExpectedType)")
            $details.Add("  Compliant: $isCompliant")
            $details.Add("  Planned action: $($entry.PlannedAction)")
            $details.Add("  Warning: $($entry.Warnings)")
        } catch {
            $errors++
            $details.Add("ERROR [$($view.Label)] $($entry.Id): $($_.Exception.Message)")
        }
    }
}`,
    finalize: String.raw`${profileCleanupResult(profileTargeting)}Write-Output "ERS; fingerprint=$PackageFingerprint; role=DryRun; total=$total; compliant=$compliant; non-compliant=$nonCompliant; errors=$errors"
${profileMessages(profileTargeting)}$details | Write-Output
$exitCode = if ($nonCompliant -gt 0 -or $errors -gt 0) { 1 } else { 0 }`,
  };
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

export function wrapBody(body: RoleBody, profileTargeting: boolean): string {
  if (!profileTargeting) return `${body.execute}\n${body.finalize}\nexit $exitCode`;
  return `try {
    Initialize-ProfileTargetPlans
    $entries = @(Expand-RegistryEntriesForProfiles -SourceEntries $entries)
${indent(body.execute)}
} finally {
    Close-SelfLoadedProfileHives
}
${body.finalize}
exit $exitCode`;
}

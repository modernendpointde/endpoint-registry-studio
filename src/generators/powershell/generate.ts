import { effectiveDesiredMutation, effectiveUserHive } from "../../domain/effectiveBehavior";
import { GENERATOR_VERSION, displayValue } from "../../domain/registry/model";
import {
  packageFingerprint,
  type DeploymentPackage,
  type RegistryItem,
} from "../../domain/workspace/workspace";
import { analyzeFeatures, desiredAction, revertAction, roleItems } from "./features";
import {
  UTF8_DECODER,
  isSafeAsciiLiteral,
  psBoolean,
  psHive,
  psKind,
  psString,
  psText,
  psValue,
  psViews,
  utf8Base64,
} from "./literals";
import { profileEngine } from "./profileRuntime";
import {
  dryRunDisplayEngine,
  exactReadEngine,
  mutationEngine,
  registryAccess,
} from "./registryRuntime";
import { DEVICE_MARK_HELPER } from "./deviceMark";
import { detectBody, dryRunBody, mutationBody, wrapBody } from "./roleRenderer";
import type { RenderContext, ScriptFeatures, ScriptKind } from "./types";

export type { ScriptKind } from "./types";

function metadata(pkg: DeploymentPackage, kind: ScriptKind): string {
  const context = pkg.deployment.runContext === "System" ? "SYSTEM" : "the logged-on user";
  const normalizedName = pkg.name.replace(/[\r\n]+/g, " ");
  const nameLine = isSafeAsciiLiteral(normalizedName)
    ? `# Deployment Package: ${normalizedName}`
    : `# Deployment Package name (UTF-8 Base64): ${utf8Base64(normalizedName)}`;
  return [
    "# Endpoint Registry Studio",
    `# Generator version: ${GENERATOR_VERSION}`,
    nameLine,
    `# Deployment Package fingerprint: ${packageFingerprint(pkg)}`,
    `# Script: ${kind}`,
    `# Expected execution context: ${context}`,
    "# Generated deterministically; Windows PowerShell 5.1 compatible; no external modules.",
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$PackageFingerprint = '${packageFingerprint(pkg)}'`,
  ].join("\n");
}

function commonEntryLines(
  item: RegistryItem,
  pkg: DeploymentPackage,
  context: RenderContext,
  profileTargeting: boolean,
): string[] {
  const lines = [
    `        Id = ${psText(item.id, context)}`,
    `        Hive = ${psHive(item)}`,
    `        HiveLabel = ${psString(item.registry.hive)}`,
    `        KeyPath = ${psText(item.registry.keyPath, context)}`,
    `        ValueName = ${psText(item.registry.valueName, context)}`,
    `        Views = ${psViews(item.registry.view, pkg.deployment.runIn64BitPowerShell)}`,
  ];
  if (profileTargeting && item.registry.hive === "HKEY_CURRENT_USER") {
    const userHive = effectiveUserHive(item, pkg);
    lines.push(
      `        UserHiveTarget = ${psString(userHive?.target ?? "")}`,
      `        IncludeDefaultUser = ${psBoolean(userHive?.includeDefaultUser ?? false)}`,
    );
  }
  return lines;
}

function readEntryLines(item: RegistryItem, context: RenderContext, dryRun: boolean): string[] {
  const desired = effectiveDesiredMutation(item);
  if (desired.kind !== "SetValue") {
    const check =
      desired.kind === "DeleteKeyRecursive"
        ? "KeyAbsent"
        : desired.kind === "DeleteValueAndEmptyKey"
          ? "KeyIfEmpty"
          : "ValueAbsent";
    return [
      `        Check = '${check}'`,
      ...(dryRun
        ? [
            "        ExpectedType = '(not applicable)'",
            "        ExpectedDisplay = '(absent)'",
            `        PlannedAction = ${psString(plannedAction(item))}`,
            `        Warnings = ${psString(dryRunWarnings(item))}`,
          ]
        : []),
    ];
  }
  return [
    "        Check = 'Exact'",
    `        Kind = ${psKind(desired.value.type)}`,
    `        Value = ${psValue(desired.value, context)}`,
    `        Sequence = ${psBoolean(
      desired.value.type === "MultiString" || desired.value.type === "Binary",
    )}`,
    ...(dryRun
      ? [
          `        ExpectedType = '${desired.value.type}'`,
          `        ExpectedDisplay = ${psText(displayValue(desired.value), context)}`,
          `        PlannedAction = ${psString(plannedAction(item))}`,
          `        Warnings = ${psString(dryRunWarnings(item))}`,
        ]
      : []),
  ];
}

function mutationEntryLines(
  item: RegistryItem,
  pkg: DeploymentPackage,
  kind: ScriptKind,
  context: RenderContext,
): string[] {
  const action = kind === "Uninstall" ? revertAction(item, pkg) : desiredAction(item);
  if (!action) return [];
  const lines = [`        Action = '${action}'`];
  if (action === "SetValue") {
    const value = kind === "Uninstall" ? item.registry.rollbackValue : item.registry.value;
    lines.push(
      `        Kind = ${psKind(value.type)}`,
      `        Value = ${psValue(value, context)}`,
    );
  }
  return lines;
}

function plannedAction(item: RegistryItem): string {
  switch (desiredAction(item)) {
    case "SetValue":
      return "Set exact Registry type and value";
    case "DeleteValue":
      return "Delete Registry value";
    case "DeleteValueAndEmptyKey":
      return "Delete Registry value and empty key";
    case "DeleteKeyRecursive":
      return "Delete Registry key recursively";
  }
}

function dryRunWarnings(item: RegistryItem): string {
  const warnings: string[] = [];
  if (item.registry.hive === "HKEY_CURRENT_USER") {
    warnings.push("HKCU depends on the configured execution context.");
  }
  if (effectiveDesiredMutation(item).kind === "DeleteKeyRecursive") {
    warnings.push("Recursive key deletion.");
  }
  if (item.registry.view === "Auto") {
    warnings.push("Auto view depends on PowerShell host architecture.");
  }
  if (item.registry.view === "Auto" && /(^|\\)WOW6432Node(\\|$)/i.test(item.registry.keyPath)) {
    warnings.push("Auto plus WOW6432Node requires effective-view review.");
  }
  if (/^SOFTWARE\\Policies(\\|$)/i.test(item.registry.keyPath)) {
    warnings.push("Policy-managed path may be overwritten.");
  }
  return warnings.join(" ");
}

function entryBlock(
  pkg: DeploymentPackage,
  kind: ScriptKind,
  items: readonly RegistryItem[],
  features: ScriptFeatures,
  context: RenderContext,
): string {
  const readRole = kind === "Detect" || kind === "Win32Detect" || kind === "DryRun";
  const literals = items.map((item) => {
    const lines = commonEntryLines(item, pkg, context, features.profileTargeting);
    lines.push(
      ...(readRole
        ? readEntryLines(item, context, kind === "DryRun")
        : mutationEntryLines(item, pkg, kind, context)),
    );
    return ["    [ordered]@{", ...lines, "    }"].join("\n");
  });
  return `$entries = @(\n${literals.join("\n")}\n)`;
}

export function generatePowerShell(pkg: DeploymentPackage, kind: ScriptKind): string {
  const items = roleItems(pkg, kind);
  const features = analyzeFeatures(pkg, kind, items);
  const context: RenderContext = { usesUtf8Decoder: false };
  const entries = entryBlock(pkg, kind, items, features, context);
  const readRole = kind === "Detect" || kind === "Win32Detect" || kind === "DryRun";
  const writeDeviceLog = !readRole && pkg.deployment.runContext === "System";
  const body =
    kind === "Detect" || kind === "Win32Detect"
      ? detectBody(kind, features.profileTargeting)
      : kind === "DryRun"
        ? dryRunBody(features.profileTargeting)
        : mutationBody(kind, features.profileTargeting, writeDeviceLog);
  return [
    metadata(pkg, kind),
    context.usesUtf8Decoder ? UTF8_DECODER : "",
    entries,
    registryAccess,
    readRole ? exactReadEngine(features.exactSequence) : "",
    kind === "DryRun" ? dryRunDisplayEngine() : "",
    readRole ? "" : mutationEngine(features.actions),
    profileEngine(features),
    writeDeviceLog ? DEVICE_MARK_HELPER : "",
    wrapBody(body, features.profileTargeting),
  ]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\r\n/g, "\n")
    .trimEnd()
    .concat("\n");
}

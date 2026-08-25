import { PRIMARY_DEPLOYMENT_TARGETS } from "../domain/workspace/deployment";
import {
  GENERATOR_VERSION,
  HIVES,
  normalizeQWord,
  REGISTRY_TYPES,
  REGISTRY_VIEWS,
  type RegistryValue,
} from "../domain/registry/model";
import {
  PACKAGE_KIND,
  WORKSPACE_KIND,
  WORKSPACE_SCHEMA_VERSION,
  cloneDeploymentPackage,
  deploymentPackageLabel,
  packageFingerprint,
  type DeploymentConfiguration,
  type DeploymentPackage,
  type RegistryItem,
  type RegistryPackage,
  type RegistryWorkspace,
  type RunContext,
  type UserHiveConfiguration,
  type UserHiveTarget,
} from "../domain/workspace/workspace";

export const MAX_REGISTRY_JSON_BYTES = 5 * 1024 * 1024;
const MAX_PACKAGES = 10_000;
const MAX_ITEMS = 10_000;
const RUN_CONTEXTS = ["System", "LoggedOnUser"] as const satisfies readonly RunContext[];
const USER_HIVE_TARGETS = [
  "AllSignedInUsers",
  "AllExistingProfiles",
] as const satisfies readonly UserHiveTarget[];

export class RegistryJsonImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryJsonImportError";
  }
}

export type RegistryJsonImport =
  | { kind: "workspace"; workspace: RegistryWorkspace }
  | { kind: "package"; package: RegistryPackage };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new RegistryJsonImportError(`${field} must be an object.`);
  return value;
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedFields = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedFields.has(key));
  if (unknown) {
    throw new RegistryJsonImportError(
      `${field}.${unknown} is not supported by schema ${WORKSPACE_SCHEMA_VERSION}.`,
    );
  }
}

function stringValue(value: unknown, field: string, max = 32_768): string {
  if (typeof value !== "string" || value.length > max) {
    throw new RegistryJsonImportError(`${field} must be a string of at most ${max} characters.`);
  }
  return value;
}

function optionalStringValue(value: unknown, field: string, max: number): string | undefined {
  return value === undefined ? undefined : stringValue(value, field, max);
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new RegistryJsonImportError(`${field} must be a boolean.`);
  }
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new RegistryJsonImportError(`${field} contains an unsupported value.`);
  }
  return value as T;
}

function requireCurrentEnvelope(
  raw: Record<string, unknown>,
  kind: typeof WORKSPACE_KIND | typeof PACKAGE_KIND,
  label: "Workspace" | "Package",
): void {
  if (raw.kind !== kind) {
    throw new RegistryJsonImportError(`Unsupported JSON kind; expected ${kind}.`);
  }
  if (raw.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new RegistryJsonImportError(
      `Unsupported ${label.toLowerCase()} schema version. Only schema ${WORKSPACE_SCHEMA_VERSION} is supported.`,
    );
  }
}

function parseValue(value: unknown, field: string): RegistryValue {
  const raw = requireRecord(value, field);
  rejectUnknownFields(raw, ["type", "data"], field);
  const type = enumValue(raw.type, REGISTRY_TYPES, `${field}.type`);
  const data = raw.data;
  if (type === "String" || type === "ExpandString") {
    return { type, data: stringValue(data, `${field}.data`, 1_000_000) };
  }
  if (type === "MultiString") {
    if (!Array.isArray(data) || !data.every((item): item is string => typeof item === "string")) {
      throw new RegistryJsonImportError(`${field}.data must be an array of strings.`);
    }
    return { type, data: [...data] };
  }
  if (type === "Binary") {
    if (
      !Array.isArray(data) ||
      !data.every(
        (item): item is number =>
          typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 255,
      )
    ) {
      throw new RegistryJsonImportError(
        `${field}.data must be an array of byte integers from 0 to 255.`,
      );
    }
    return { type, data: [...data] };
  }
  if (type === "DWord") {
    if (typeof data !== "number" || !Number.isInteger(data) || data < 0 || data > 4_294_967_295) {
      throw new RegistryJsonImportError(
        `${field}.data must be an unsigned 32-bit integer from 0 to 4294967295.`,
      );
    }
    return { type, data };
  }
  const qword = stringValue(data, `${field}.data`, 20);
  if (normalizeQWord(qword) !== qword) {
    throw new RegistryJsonImportError(
      `${field}.data must be a canonical unsigned 64-bit decimal string from 0 to 18446744073709551615.`,
    );
  }
  return { type, data: qword };
}

function parseDefinition(value: unknown, field: string): RegistryItem["registry"] {
  const raw = requireRecord(value, field);
  rejectUnknownFields(
    raw,
    [
      "desiredState",
      "deletionMode",
      "hive",
      "keyPath",
      "valueName",
      "value",
      "view",
      "rollbackMode",
      "rollbackValue",
    ],
    field,
  );
  return {
    desiredState: enumValue(raw.desiredState, ["Present", "Absent"], `${field}.desiredState`),
    deletionMode: enumValue(
      raw.deletionMode,
      ["Value", "KeyIfEmpty", "KeyRecursive"],
      `${field}.deletionMode`,
    ),
    hive: enumValue(raw.hive, HIVES, `${field}.hive`),
    keyPath: stringValue(raw.keyPath, `${field}.keyPath`),
    valueName: stringValue(raw.valueName, `${field}.valueName`),
    value: parseValue(raw.value, `${field}.value`),
    view: enumValue(raw.view, REGISTRY_VIEWS, `${field}.view`),
    rollbackMode: enumValue(
      raw.rollbackMode,
      ["None", "DeleteManagedValue", "SetDefinedRollbackValue"],
      `${field}.rollbackMode`,
    ),
    rollbackValue: parseValue(raw.rollbackValue, `${field}.rollbackValue`),
  };
}

function parseDeployment(value: unknown, field: string): DeploymentConfiguration {
  const raw = requireRecord(value, field);
  rejectUnknownFields(
    raw,
    ["method", "runContext", "runIn64BitPowerShell", "enforceSignatureCheck"],
    field,
  );
  return {
    method: enumValue(raw.method, PRIMARY_DEPLOYMENT_TARGETS, `${field}.method`),
    runContext: enumValue(raw.runContext, RUN_CONTEXTS, `${field}.runContext`),
    runIn64BitPowerShell: booleanValue(raw.runIn64BitPowerShell, `${field}.runIn64BitPowerShell`),
    enforceSignatureCheck: booleanValue(
      raw.enforceSignatureCheck,
      `${field}.enforceSignatureCheck`,
    ),
  };
}

function parseUserHive(value: unknown, field: string): UserHiveConfiguration {
  const raw = requireRecord(value, field);
  rejectUnknownFields(raw, ["userHiveTarget", "includeDefaultUser"], field);
  const userHiveTarget =
    raw.userHiveTarget === undefined
      ? undefined
      : enumValue(raw.userHiveTarget, USER_HIVE_TARGETS, `${field}.userHiveTarget`);
  const includeDefaultUser = booleanValue(raw.includeDefaultUser, `${field}.includeDefaultUser`);
  if (includeDefaultUser && userHiveTarget !== "AllExistingProfiles") {
    throw new RegistryJsonImportError(
      `${field}.includeDefaultUser requires the AllExistingProfiles target.`,
    );
  }
  return {
    ...(userHiveTarget ? { userHiveTarget } : {}),
    includeDefaultUser,
  };
}

function parseItem(value: unknown, field: string): RegistryItem {
  const raw = requireRecord(value, field);
  rejectUnknownFields(raw, ["id", "enabled", "registry", "userHive", "description"], field);
  return {
    id: stringValue(raw.id, `${field}.id`, 128),
    enabled: booleanValue(raw.enabled, `${field}.enabled`),
    registry: parseDefinition(raw.registry, `${field}.registry`),
    userHive: parseUserHive(raw.userHive, `${field}.userHive`),
    description: stringValue(raw.description, `${field}.description`, 10_000),
  };
}

function ensureUniqueItemIds(items: readonly RegistryItem[], field: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new RegistryJsonImportError(`${field} contains duplicate item ID ${item.id}.`);
    }
    ids.add(item.id);
  }
}

function parsePackage(value: unknown, field: string): DeploymentPackage {
  const raw = requireRecord(value, field);
  rejectUnknownFields(raw, ["id", "name", "deployment", "items"], field);
  if (!Array.isArray(raw.items) || raw.items.length > MAX_ITEMS) {
    throw new RegistryJsonImportError(`${field}.items must contain at most ${MAX_ITEMS} items.`);
  }
  const items = raw.items.map((item, index) => parseItem(item, `${field}.items[${index}]`));
  ensureUniqueItemIds(items, `${field}.items`);
  return {
    id: stringValue(raw.id, `${field}.id`, 128),
    name: stringValue(raw.name, `${field}.name`, 256),
    deployment: parseDeployment(raw.deployment, `${field}.deployment`),
    items,
  };
}

function parseJson(text: string): unknown {
  if (new TextEncoder().encode(text).byteLength > MAX_REGISTRY_JSON_BYTES) {
    throw new RegistryJsonImportError(
      `File exceeds the ${MAX_REGISTRY_JSON_BYTES}-byte import limit.`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RegistryJsonImportError("File is not valid JSON.");
  }
}

function parseWorkspaceRecord(raw: Record<string, unknown>): RegistryWorkspace {
  requireCurrentEnvelope(raw, WORKSPACE_KIND, "Workspace");
  rejectUnknownFields(
    raw,
    ["schemaVersion", "kind", "generatorVersion", "id", "name", "packages"],
    "workspace",
  );
  if (!Array.isArray(raw.packages) || raw.packages.length > MAX_PACKAGES) {
    throw new RegistryJsonImportError(`packages must contain at most ${MAX_PACKAGES} packages.`);
  }
  const packages = raw.packages.map((pkg, index) => parsePackage(pkg, `packages[${index}]`));
  const packageIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const pkg of packages) {
    if (packageIds.has(pkg.id)) {
      throw new RegistryJsonImportError(`Workspace contains duplicate package ID ${pkg.id}.`);
    }
    packageIds.add(pkg.id);
    for (const item of pkg.items) {
      if (itemIds.has(item.id)) {
        throw new RegistryJsonImportError(`Workspace contains duplicate item ID ${item.id}.`);
      }
      itemIds.add(item.id);
    }
  }
  if (itemIds.size > MAX_ITEMS) {
    throw new RegistryJsonImportError(`Workspace contains more than ${MAX_ITEMS} Registry items.`);
  }
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    kind: WORKSPACE_KIND,
    generatorVersion: stringValue(raw.generatorVersion, "generatorVersion", 64),
    id: stringValue(raw.id, "id", 128),
    name: stringValue(raw.name, "name", 256),
    packages,
  };
}

function parsePackageFile(raw: Record<string, unknown>): RegistryPackage {
  requireCurrentEnvelope(raw, PACKAGE_KIND, "Package");
  rejectUnknownFields(
    raw,
    [
      "schemaVersion",
      "kind",
      "generatorVersion",
      "sourceWorkspaceId",
      "sourceWorkspaceName",
      "package",
      "fingerprint",
    ],
    "packageFile",
  );
  const pkg = parsePackage(raw.package, "package");
  const generatorVersion = stringValue(raw.generatorVersion, "generatorVersion", 64);
  const fingerprint = stringValue(raw.fingerprint, "fingerprint", 64);
  if (fingerprint !== packageFingerprint(pkg, generatorVersion)) {
    throw new RegistryJsonImportError("Package fingerprint does not match its Deployment Package.");
  }
  const sourceWorkspaceId = optionalStringValue(raw.sourceWorkspaceId, "sourceWorkspaceId", 128);
  const sourceWorkspaceName = optionalStringValue(
    raw.sourceWorkspaceName,
    "sourceWorkspaceName",
    256,
  );
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    kind: PACKAGE_KIND,
    generatorVersion,
    ...(sourceWorkspaceId === undefined ? {} : { sourceWorkspaceId }),
    ...(sourceWorkspaceName === undefined ? {} : { sourceWorkspaceName }),
    package: pkg,
    fingerprint,
  };
}

function parseRoot(text: string): Record<string, unknown> {
  return requireRecord(parseJson(text), "File root");
}

export function importRegistryJson(text: string): RegistryJsonImport {
  const raw = parseRoot(text);
  if (raw.kind === WORKSPACE_KIND) {
    return { kind: "workspace", workspace: parseWorkspaceRecord(raw) };
  }
  if (raw.kind === PACKAGE_KIND) {
    return { kind: "package", package: parsePackageFile(raw) };
  }
  throw new RegistryJsonImportError(
    `Unsupported JSON kind. Only ${WORKSPACE_KIND} and ${PACKAGE_KIND} schema ${WORKSPACE_SCHEMA_VERSION} files are supported.`,
  );
}

export function exportWorkspace(workspace: RegistryWorkspace): string {
  return `${JSON.stringify({ ...workspace, schemaVersion: WORKSPACE_SCHEMA_VERSION, kind: WORKSPACE_KIND, generatorVersion: GENERATOR_VERSION }, null, 2)}\n`;
}

function createRegistryPackage(
  workspace: RegistryWorkspace,
  pkg: DeploymentPackage,
): RegistryPackage {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    kind: PACKAGE_KIND,
    generatorVersion: GENERATOR_VERSION,
    sourceWorkspaceId: workspace.id,
    sourceWorkspaceName: workspace.name,
    package: pkg,
    fingerprint: packageFingerprint(pkg),
  };
}

export function exportRegistryPackage(
  workspace: RegistryWorkspace,
  pkg: DeploymentPackage,
): string {
  return `${JSON.stringify(createRegistryPackage(workspace, pkg), null, 2)}\n`;
}

export function importPackageAsCopy(pkg: RegistryPackage): DeploymentPackage {
  const copy = cloneDeploymentPackage(pkg.package);
  return { ...copy, name: `${deploymentPackageLabel(pkg.package)} copy` };
}

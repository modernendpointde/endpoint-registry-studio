export const ADMX_TOKEN_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const ADMX_TEMPLATE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const RESERVED_NAMESPACE_PREFIXES = ["microsoft", "windows"];

export function isAdmxToken(value: string): boolean {
  return ADMX_TOKEN_PATTERN.test(value);
}

export function isAdmxTemplateVersion(value: string): boolean {
  return ADMX_TEMPLATE_VERSION_PATTERN.test(value);
}

export function admxNamespace(vendorId: string, productId: string): string {
  return vendorId + "." + productId;
}

export function isReservedAdmxNamespace(namespace: string): boolean {
  const first = namespace.split(".")[0]?.toLowerCase() ?? "";
  return RESERVED_NAMESPACE_PREFIXES.includes(first);
}

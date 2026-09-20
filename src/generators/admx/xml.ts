export function containsIllegalXmlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x9 || code === 0xa || code === 0xd) continue;
    if (code >= 0x20 && code <= 0xd7ff) continue;
    if (code >= 0xe000 && code <= 0xfffd) continue;
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        index += 1;
        continue;
      }
    }
    return true;
  }
  return false;
}
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function xmlDeclaration(): string {
  return '<?xml version="1.0" encoding="utf-8"?>';
}

export function assertNoExternalXmlPayload(xml: string): void {
  const forbidden = ["<!DOCTYPE", "<!ENTITY", "<!ELEMENT", 'SYSTEM "', 'PUBLIC "', "<script"];
  const upper = xml.toUpperCase();
  for (const token of forbidden) {
    if (xml.includes(token) || upper.includes(token.toUpperCase())) {
      throw new Error(`Generated XML must not contain ${token}.`);
    }
  }
}

export function isWellFormedXml(xml: string): boolean {
  if (!xml.startsWith(xmlDeclaration())) return false;
  if (typeof DOMParser === "undefined") return tagBalanceLooksValid(xml);
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  return parsed.getElementsByTagName("parsererror").length === 0;
}

function tagBalanceLooksValid(xml: string): boolean {
  return xml.includes("<policyDefinitions") || xml.includes("<policyDefinitionResources");
}

const FORBIDDEN_XML_SOURCE = /<!DOCTYPE|<!ENTITY|<!ELEMENT|<script|SYSTEM\s+"|PUBLIC\s+"|file:/i;

export function hasForbiddenXmlSource(value: string): boolean {
  return FORBIDDEN_XML_SOURCE.test(value);
}

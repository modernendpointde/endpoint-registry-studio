export type RuntimeTheme = "system" | "light" | "dark";

export const FOOTER_ITEM_KINDS = ["legalNotice", "privacy", "github", "linkedin"] as const;

export type FooterItemKind = (typeof FOOTER_ITEM_KINDS)[number];

export interface FooterItem {
  kind: FooterItemKind;
  label: string;
  url: string;
}

export interface RuntimeFooterConfig {
  items: FooterItem[];
}

export interface RuntimeConfig {
  applicationName: string;
  organizationName: string;
  logo: string;
  accentColor: string;
  defaultTheme: RuntimeTheme;
  showImport: boolean;
  footer: RuntimeFooterConfig;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  applicationName: "Endpoint Registry Studio",
  organizationName: "",
  logo: "",
  accentColor: "#3157c8",
  defaultTheme: "light",
  showImport: true,
  footer: { items: [] },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, fallback: string, max = 120): string {
  return typeof value === "string" && value.length <= max ? value : fallback;
}

function safeLocalAsset(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || value === "") return "";
  return /^(?:[a-z]+:|\/\/|\/)/i.test(value) || value.includes("..") ? "" : value;
}

function safeFooterLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.trim();
  if (label.length === 0 || label.length > 80) return undefined;
  if (/[\u0000-\u001F\u007F]/.test(label)) return undefined;
  return label;
}

function safeFooterUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  if (url.length === 0 || url.length > 2048) return undefined;
  if (/[\s\u0000-\u001F\u007F\\]/.test(url)) return undefined;
  if (url.includes("..")) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    if (!/^https:\/\//i.test(url)) return undefined;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
        return undefined;
      }
      return url;
    } catch {
      return undefined;
    }
  }
  if (url.startsWith("//")) return undefined;
  return url;
}

function parseFooterItems(value: unknown): FooterItem[] {
  if (!Array.isArray(value)) return [];
  const items: FooterItem[] = [];
  for (const candidate of value) {
    if (items.length >= 6) break;
    if (!isRecord(candidate)) continue;
    const kind = candidate.kind;
    const label = safeFooterLabel(candidate.label);
    const url = safeFooterUrl(candidate.url);
    if (
      typeof kind !== "string" ||
      !(FOOTER_ITEM_KINDS as readonly string[]).includes(kind) ||
      label === undefined ||
      url === undefined
    ) {
      continue;
    }
    items.push({ kind: kind as FooterItemKind, label, url });
  }
  return items;
}

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (!isRecord(value)) return { ...DEFAULT_RUNTIME_CONFIG };
  const theme = value.defaultTheme;
  return {
    applicationName: safeText(value.applicationName, DEFAULT_RUNTIME_CONFIG.applicationName),
    organizationName: safeText(value.organizationName, ""),
    logo: safeLocalAsset(value.logo),
    accentColor:
      typeof value.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(value.accentColor)
        ? value.accentColor
        : DEFAULT_RUNTIME_CONFIG.accentColor,
    defaultTheme:
      theme === "light" || theme === "dark" || theme === "system"
        ? theme
        : DEFAULT_RUNTIME_CONFIG.defaultTheme,
    showImport: typeof value.showImport === "boolean" ? value.showImport : true,
    footer: isRecord(value.footer)
      ? { items: parseFooterItems(value.footer.items) }
      : { items: [] },
  };
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch("./config.json", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return { ...DEFAULT_RUNTIME_CONFIG };
    return parseRuntimeConfig((await response.json()) as unknown);
  } catch {
    return { ...DEFAULT_RUNTIME_CONFIG };
  }
}

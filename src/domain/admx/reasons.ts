export const ADMX_REJECTION_REASONS = [
  "DesiredStateNotPresent",
  "UnnamedValue",
  "MalformedValueName",
  "UnsupportedType",
  "InvalidValueData",
  "ExplicitRegistryView",
  "SystemUserHiveTargeting",
  "DefaultUserProcessing",
  "RevertConfigured",
  "EmptyKeyPath",
  "MalformedKeyPath",
  "Wow6432NodePath",
  "ViewDependentKeyPath",
  "MicrosoftRegistryLocation",
  "UnsupportedKeyPath",
  "SensitiveValueName",
] as const;

export type AdmxRejectionReason = (typeof ADMX_REJECTION_REASONS)[number];

export interface AdmxRejection {
  reasonCode: AdmxRejectionReason;
  message: string;
}

const MESSAGES: Record<AdmxRejectionReason, string> = {
  DesiredStateNotPresent: "An administrative template requires desired state Present.",
  UnnamedValue: "An administrative template requires a named Registry value.",
  MalformedValueName: "Value names cannot contain a NUL character.",
  UnsupportedType: "Only String, ExpandString, and DWord are supported.",
  InvalidValueData: "The typed Registry value is not valid.",
  ExplicitRegistryView: "Only Registry view Auto is supported.",
  SystemUserHiveTargeting: "SYSTEM processing of user profiles is not supported.",
  DefaultUserProcessing: "Default User processing is not supported.",
  RevertConfigured: "Win32 Revert behavior is not supported.",
  EmptyKeyPath: "A non-empty relative Registry key path is required.",
  MalformedKeyPath:
    "Key paths with empty segments, leading or trailing separators, or NUL characters are not supported.",
  Wow6432NodePath: "WOW6432Node paths cannot encode a redirected view.",
  ViewDependentKeyPath:
    "The path must be under Software\\Policies\\<Vendor>\\<Product> so Auto does not depend on WOW64 redirection.",
  MicrosoftRegistryLocation: "Microsoft and system Registry locations are not supported.",
  UnsupportedKeyPath: "The path must be under Software\\Policies\\<Vendor>\\<Product>.",
  SensitiveValueName:
    "Value names that look like secrets, tokens, credentials, or keys are not supported.",
};

export function admxRejection(reasonCode: AdmxRejectionReason): AdmxRejection {
  return { reasonCode, message: MESSAGES[reasonCode] };
}

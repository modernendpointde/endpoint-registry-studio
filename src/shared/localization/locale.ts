import { commonCopy } from "./en/common";
import { helpCopy } from "./en/help";
import { packagesCopy } from "./en/packages";
import { registryImportCopy } from "./en/registryImport";
import { registryItemsCopy } from "./en/registryItems";

export const englishUi = {
  common: commonCopy,
  packages: packagesCopy,
  registryItems: registryItemsCopy,
  registryImport: registryImportCopy,
  help: helpCopy,
} as const;

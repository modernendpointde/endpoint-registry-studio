import { Dialog } from "../../shared/ui/Overlays";

/**
 * The first question the product asks is what the administrator wants to produce. Choosing here is what
 * keeps the template path from appearing later as a surprise inside a script package.
 */
export function CreateDialog({
  onScriptPackage,
  onAdministrativeTemplate,
  onCancel,
}: {
  onScriptPackage: () => void;
  onAdministrativeTemplate: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      title="Create"
      eyebrow="What do you want to produce?"
      size="small"
      onClose={onCancel}
      footer={
        <button type="button" className="wb-button wb-button--ghost" onClick={onCancel}>
          Cancel
        </button>
      }
    >
      <div className="wb-create-choices">
        <button type="button" className="wb-create-choice" onClick={onScriptPackage}>
          <strong>Script deployment package</strong>
          <small>
            Author Registry Items and generate deterministic Windows PowerShell for Intune
            Remediation, Platform scripts, or Win32 app source. Every value change needs a new
            package.
          </small>
        </button>
        <button type="button" className="wb-create-choice" onClick={onAdministrativeTemplate}>
          <strong>Administrative template (ADMX + ADML)</strong>
          <small>
            Define policy settings that Intune imports once and then exposes in a configuration
            profile, so a value can change without regenerating a package. Registry targets come
            from a Deployment Package or are written in the template.
          </small>
        </button>
      </div>
    </Dialog>
  );
}

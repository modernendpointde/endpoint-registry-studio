import { useState } from "react";

import {
  deploymentPackageLabel,
  registryItemLabel,
  type DeploymentPackage,
  type RegistryItem,
} from "../../domain/workspace/workspace";
import { Dialog } from "../../shared/ui/Overlays";

export function TransferDialog({
  item,
  sourcePackageId,
  packages,
  onCommit,
  onClose,
}: {
  item: RegistryItem;
  sourcePackageId: string;
  packages: readonly DeploymentPackage[];
  onCommit: (targetPackageId: string, action: "move" | "copy") => void;
  onClose: () => void;
}) {
  const targets = packages.filter((pkg) => pkg.id !== sourcePackageId);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [action, setAction] = useState<"move" | "copy">("move");

  return (
    <Dialog
      title="Move or copy Registry Item"
      eyebrow="Registry Item transfer"
      size="small"
      onClose={onClose}
      footer={
        <>
          <button className="wb-button wb-button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="wb-button wb-button--primary"
            disabled={!targetId}
            onClick={() => onCommit(targetId, action)}
          >
            {action === "move" ? "Move item" : "Copy item"}
          </button>
        </>
      }
    >
      <p className="wb-dialog-lead">
        Choose where to place <strong>{registryItemLabel(item)}</strong>.
      </p>
      {targets.length === 0 ? (
        <div className="wb-callout wb-callout--info">Create another Deployment Package first.</div>
      ) : (
        <div className="wb-form">
          <label className="wb-field">
            <span>Destination package</span>
            <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              {targets.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {deploymentPackageLabel(pkg)}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="wb-choice-cards">
            <legend>Action</legend>
            <label data-selected={action === "move"}>
              <input
                type="radio"
                name="transfer"
                checked={action === "move"}
                onChange={() => setAction("move")}
              />
              <span>
                <strong>Move item</strong>
                <small>Remove it from the current package.</small>
              </span>
            </label>
            <label data-selected={action === "copy"}>
              <input
                type="radio"
                name="transfer"
                checked={action === "copy"}
                onChange={() => setAction("copy")}
              />
              <span>
                <strong>Copy item</strong>
                <small>Create an independent copy in the destination package.</small>
              </span>
            </label>
          </fieldset>
        </div>
      )}
    </Dialog>
  );
}

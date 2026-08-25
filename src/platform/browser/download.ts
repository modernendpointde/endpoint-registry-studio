import type { GeneratedArtifact } from "../../generators/types";

export function downloadArtifact(artifact: GeneratedArtifact): Promise<void> {
  let url: string | undefined;
  try {
    const blob = new Blob([artifact.content as BlobPart], { type: artifact.mediaType });
    url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.name;
    anchor.click();
    const completedUrl = url;
    window.setTimeout(() => URL.revokeObjectURL(completedUrl), 1_000);
    return Promise.resolve();
  } catch {
    if (url) URL.revokeObjectURL(url);
    return Promise.reject(new Error("The browser could not start the download."));
  }
}

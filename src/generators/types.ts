export interface GeneratedArtifact {
  name: string;
  mediaType: string;
  content: string | Uint8Array;
  purpose?: string;
}

export interface TargetArtifact extends GeneratedArtifact {
  path: string;
  purpose: string;
}

# GitHub Container Registry deployment

The repository workflow validates source, browser behavior, Compose configuration, the production image, container health, and security/cache headers before publication. Pull requests and `main` pushes build and load the image without publishing it; contributor workstations are not required to publish images.

The image name is:

```text
ghcr.io/modernendpointde/endpoint-registry-studio
```

## Tags

| Event                        | Published tag          |
| ---------------------------- | ---------------------- |
| Pull request or `main` build | None                   |
| Prerelease tag `v1.2.3-rc.1` | `1.2.3-rc.1`           |
| Stable semantic tag `v1.2.3` | `1.2.3`, then `latest` |

## Release assets

Each semantic version tag attaches:

- `endpoint-registry-studio-web-<version>.zip`: storage-free static build
- `endpoint-registry-studio-selfhosted-<version>.zip`: persistent build served by the container
- `SHA256SUMS`: SHA-256 checksums for both archives

Both archives include `LICENSE` and `THIRD_PARTY_NOTICES.md`. The container image serves the same files beside `index.html`.

The archives support root or subdirectory hosting and are not tied to a provider. GitHub Pages is not used. See [Docker and static hosting](DOCKER_AND_HOSTING.md).

## Pull and run

```bash
docker pull ghcr.io/modernendpointde/endpoint-registry-studio:latest
docker run -d --name endpoint-registry-studio \
  -p 8080:8080 \
  --read-only \
  --tmpfs /tmp:size=16m,mode=1777 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  ghcr.io/modernendpointde/endpoint-registry-studio:latest
```

Open `http://localhost:8080`. The container serves static files with unprivileged nginx on internal port 8080.

The quick start and Compose default to the latest stable image (`latest`). Pull requests and `main` builds still build and smoke-test the production container, but they do not publish an image. Set `IMAGE_TAG` to an exact release such as `1.2.3` when a deployment must remain pinned.

Compose uses the same image and hardening:

```bash
docker compose pull
docker compose up -d
```

Set `HOST_PORT` and `IMAGE_TAG` when required.

## Authentication

Public packages can be pulled anonymously. If the package is private, authenticate with a GitHub token that has `read:packages`:

```bash
export CR_PAT="<token>"
echo "$CR_PAT" | docker login ghcr.io -u <github-user> --password-stdin
unset CR_PAT
```

Do not commit tokens or place them in Compose or `.env`. Workflow publication uses `GITHUB_TOKEN` with package write permission limited to the publishing job.

## Release process

Create and push a semantic tag. Stable `vX.Y.Z` and prerelease tags such as `vX.Y.Z-rc.1` publish only their exact version image after validation, including the container job. The workflow attaches both static bundles plus checksums and creates or updates a curated release title and professional static release body; it does not generate release notes from commit history. After both an exact stable image and its release succeed, the same tag workflow promotes the built image digest to the explicit `latest` channel and verifies the resulting digest. Prereleases never update `latest`, and the workflow does not depend on a follow-up release event.

To repair `latest` without creating another release, open **Actions**, select **Validate and publish**, choose **Run workflow**, enable **Promote the current stable GitHub release image to latest**, and run the workflow. The repair job resolves GitHub's current stable release, verifies that it is a published exact `vX.Y.Z` release, promotes that release's immutable image digest, and verifies `latest` afterward.

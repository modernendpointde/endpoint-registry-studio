# Docker and static hosting

## Static artifacts

Build the storage-free variant:

```bash
npm ci
npm run build:web
```

Serve `dist-web/` from any static web server. Relative asset paths support both a domain root and subdirectories without a rewrite rule.

GitHub releases provide two ready-to-serve archives:

| Archive                                             | Behavior                                           |
| --------------------------------------------------- | -------------------------------------------------- |
| `endpoint-registry-studio-web-<version>.zip`        | Storage-free, memory-only Workspace                |
| `endpoint-registry-studio-selfhosted-<version>.zip` | Persistent Workspace, matching the Docker artifact |

Verify downloads with the release `SHA256SUMS`. Persistent browser storage requires HTTPS or localhost.
Both archives include the project `LICENSE` and `THIRD_PARTY_NOTICES.md` at their root.

Keep `config.json` beside `index.html`. Missing or invalid configuration falls back to safe defaults.

## Static hosting

Deploy the storage-free bundle to any static web host: upload the extracted files over FTPES, SFTP, or rsync and serve them over HTTPS. The host serves static files only; Workspace and Registry content remains in the visitor's browser.

## Runtime configuration

Supported settings include application and organization names, a local logo, accent color, default theme, import visibility, and up to six footer links. Logo paths must be local and relative; footer URLs must be HTTPS or same-origin relative links. Values are rendered as data and cannot inject HTML, JavaScript, or CSS.

Hosted deployments can provide branding, legal links, and project-profile links through `config.json` without rebuilding the application.

## Docker

Pull and run the latest stable image:

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

Open `http://localhost:8080`. The unprivileged nginx container listens on port 8080. The runtime is pinned by multi-platform digest to the patched stable official nginx-unprivileged image selected for the release.

Compose provides the same defaults:

```bash
docker compose pull
docker compose up -d
```

Set `HOST_PORT` to change the host port and `IMAGE_TAG` to select an image tag. Keep registry credentials out of `.env`.

The container uses a read-only filesystem, dropped capabilities, no privilege escalation, a small `/tmp` tmpfs, and a health check. nginx applies CSP and related security headers; hashed assets are immutable, `index.html` uses `no-cache`, and `config.json` uses `no-store`. `LICENSE` and `THIRD_PARTY_NOTICES.md` are served beside the application. Terminate TLS at the hosting platform or reverse proxy.

Mount a custom runtime configuration read-only:

```yaml
volumes:
  - ./config.json:/usr/share/nginx/html/config.json:ro
```

See [GHCR deployment](GHCR_DEPLOYMENT.md) for tags and release assets.

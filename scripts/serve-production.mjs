import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative } from "node:path";

const distName = process.env.DIST_DIR || "dist-web";
if (!/^[A-Za-z0-9._-]+$/.test(distName)) {
  throw new Error("DIST_DIR must be a simple directory name inside the repository.");
}
const root = join(process.cwd(), distName);
const port = Number(process.env.PORT || 4173);
const nestedPrefix = "/tools/registry-studio";
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

if (!existsSync(join(root, "index.html"))) {
  throw new Error("Production build not found. Run npm run build first.");
}

function requestedFile(url) {
  const pathname = new URL(url, "http://127.0.0.1").pathname;
  const stripped =
    pathname === nestedPrefix || pathname === `${nestedPrefix}/`
      ? "/"
      : pathname.startsWith(`${nestedPrefix}/`)
        ? pathname.slice(nestedPrefix.length)
        : pathname;
  const requested = stripped.endsWith("/") ? `${stripped}index.html` : stripped;
  const fullPath = normalize(join(root, requested));
  return relative(root, fullPath).startsWith("..") ? undefined : fullPath;
}

const server = createServer(async (request, response) => {
  const file = requestedFile(request.url || "/");
  if (!file) {
    response.writeHead(400).end("Bad request");
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Production fixture available on http://127.0.0.1:${port}\n`);
});

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);

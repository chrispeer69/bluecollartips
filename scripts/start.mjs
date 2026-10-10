import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname } from "node:path";
import { constants as zlibConstants, createBrotliCompress, createGzip, brotliCompressSync, gzipSync } from "node:zlib";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const { default: app } = await import("../dist/server/server.js");

const port = Number(process.env.PORT ?? 3000);
const clientDir = new URL("../dist/client/", import.meta.url);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
const COMPRESSIBLE = /^(text\/|application\/(json|xml|javascript|manifest\+json)|image\/svg\+xml)/;

// Files copied from public/ to the build root (robots.txt, icons, manifest…).
// Only these exact names are served, so routes like /:companySlug still work.
const rootFiles = new Set(
  (await readdir(clientDir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => `/${e.name}`),
);

function pickEncoding(request) {
  const accept = String(request.headers["accept-encoding"] ?? "");
  if (/\bbr\b/.test(accept)) return "br";
  if (/\bgzip\b/.test(accept)) return "gzip";
  return null;
}

const staticCache = new Map();
async function serveFile(request, response, pathname, cacheControl) {
  const type = mimeTypes[extname(pathname)] ?? "application/octet-stream";
  const encoding = COMPRESSIBLE.test(type) ? pickEncoding(request) : null;
  const key = `${pathname}|${encoding}`;
  let body = staticCache.get(key);
  if (!body) {
    const raw = await readFile(new URL(`.${pathname}`, clientDir));
    body = encoding === "br"
      ? brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 } })
      : encoding === "gzip" ? gzipSync(raw) : raw;
    staticCache.set(key, body);
  }
  response.statusCode = 200;
  response.setHeader("Content-Type", type);
  response.setHeader("Cache-Control", cacheControl);
  response.setHeader("Content-Length", body.length);
  if (COMPRESSIBLE.test(type)) response.setHeader("Vary", "Accept-Encoding");
  if (encoding) response.setHeader("Content-Encoding", encoding);
  response.end(request.method === "HEAD" ? undefined : body);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `localhost:${port}`}`);
    const { pathname } = url;
    const isRead = request.method === "GET" || request.method === "HEAD";
    if (pathname.startsWith("/assets/")) {
      try {
        return await serveFile(request, response, pathname, "public, max-age=31536000, immutable");
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "EISDIR") throw error;
        response.statusCode = 404;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        return response.end("Not found");
      }
    }
    if (isRead && rootFiles.has(pathname)) {
      return await serveFile(request, response, pathname, "public, max-age=3600");
    }
    // One URL per page: /guides/tip-pooling/ → /guides/tip-pooling (permanent).
    if (isRead && pathname.length > 1 && pathname.endsWith("/")) {
      response.statusCode = 301;
      response.setHeader("Location", `${pathname.replace(/\/+$/, "") || "/"}${url.search}`);
      return response.end();
    }

    const origin = `http://${request.headers.host ?? `localhost:${port}`}`;
    const body = isRead ? undefined : request;
    const webRequest = new Request(new URL(request.url ?? "/", origin), {
      method: request.method,
      headers: request.headers,
      body,
      duplex: body ? "half" : undefined,
    });
    const webResponse = await app.fetch(webRequest);
    response.statusCode = webResponse.status;
    webResponse.headers.forEach((value, key) => response.setHeader(key, value));
    if (!webResponse.body) return response.end();

    // Compress pages (HTML, sitemap, text). Server-function and API traffic is
    // passed through untouched so streaming responses keep working.
    const type = webResponse.headers.get("content-type") ?? "";
    const encoding = isRead && !webResponse.headers.has("content-encoding") && /^(text\/html|application\/xml|text\/plain)/.test(type)
      ? pickEncoding(request) : null;
    if (!encoding) {
      for await (const chunk of webResponse.body) response.write(chunk);
      return response.end();
    }
    response.removeHeader("Content-Length");
    response.setHeader("Content-Encoding", encoding);
    response.setHeader("Vary", "Accept-Encoding");
    const zip = encoding === "br"
      ? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
      : createGzip();
    zip.pipe(response);
    for await (const chunk of webResponse.body) {
      zip.write(chunk);
      // Flush each chunk so streamed HTML still reaches the browser promptly.
      zip.flush();
    }
    zip.end();
  } catch (error) {
    console.error(error);
    if (response.headersSent) return response.end();
    response.statusCode = 500;
    response.end("Internal Server Error");
  }
});

server.listen(port, "0.0.0.0", () => console.log(`Blue Collar Tips listening on ${port}`));

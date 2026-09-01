import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const { default: app } = await import("../dist/server/server.js");

const port = Number(process.env.PORT ?? 3000);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? `localhost:${port}`}`).pathname;
    if (pathname.startsWith("/assets/")) {
      const assetUrl = new URL(`../dist/client${pathname}`, import.meta.url);
      const asset = await readFile(assetUrl);
      response.statusCode = 200;
      response.setHeader("Content-Type", mimeTypes[extname(pathname)] ?? "application/octet-stream");
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return response.end(request.method === "HEAD" ? undefined : asset);
    }
    const origin = `http://${request.headers.host ?? `localhost:${port}`}`;
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : request;
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
    for await (const chunk of webResponse.body) response.write(chunk);
    response.end();
  } catch (error) {
    console.error(error);
    response.statusCode = 500;
    response.end("Internal Server Error");
  }
});

server.listen(port, "0.0.0.0", () => console.log(`Blue Collar Tips listening on ${port}`));

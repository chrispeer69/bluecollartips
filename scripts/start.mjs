import { createServer } from "node:http";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const { default: app } = await import("../dist/server/server.js");

const port = Number(process.env.PORT ?? 3000);
const server = createServer(async (request, response) => {
  try {
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

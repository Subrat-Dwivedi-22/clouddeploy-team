import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const assets = new Map();
for (const [path, file, type] of [
  ["/", "index.html", "text/html"], ["/site.css", "site.css", "text/css"], ["/site.js", "site.js", "text/javascript"],
]) {
  assets.set(path, { body: await readFile(new URL(file, import.meta.url)), type });
}

const port = Number(process.env.PORT ?? 8080);
createServer((request, response) => {
  console.log(`${new Date().toISOString()} ${request.method} ${request.url}`);
  const path = (request.url ?? "/").split("?")[0];
  if (!["GET","HEAD"].includes(request.method)) return response.writeHead(405, {Allow:"GET, HEAD"}).end();
  if (path === "/health" || path === "/" && request.headers.accept?.includes("application/json") && !request.headers.accept.includes("text/html")) {
    return response.writeHead(200, {"Content-Type":"application/json; charset=utf-8"}).end(JSON.stringify({app:"CloudDeploy sample",hostname:process.env.HOSTNAME ?? "local",ok:true}));
  }
  const asset = assets.get(path);
  if (!asset) return response.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"}).end("Page not found");
  response.writeHead(200, { "Content-Type": asset.type + "; charset=utf-8", "Vary":"Accept", "X-Content-Type-Options":"nosniff" }).end(asset.body);
}).listen(port, "0.0.0.0", () => console.log(`Sample app listening on ${port}`));

import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { createServer } from "node:http";

const [, , rootArg = "web", portArg = "4173"] = process.argv;
const root = resolve(process.cwd(), rootArg);
const port = Number(portArg);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function sendNotFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const candidate = normalize(relativePath);
  const filePath = resolve(root, candidate);

  if (!filePath.startsWith(root)) {
    sendNotFound(response);
    return;
  }

  let target = filePath;
  if (existsSync(target) && statSync(target).isDirectory()) {
    target = join(target, "index.html");
  }

  if (!existsSync(target)) {
    sendNotFound(response);
    return;
  }

  const extension = extname(target);
  response.writeHead(200, {
    "Content-Type": contentTypes[extension] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(target).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} at http://127.0.0.1:${port}`);
});

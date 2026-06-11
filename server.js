import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fetchLivePrices } from "./src/liveAdapters.js";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 1024 * 1024) {
      throw new Error("Request body too large");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function resolveRequestPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const filePath = cleanPath === "/" ? "/index.html" : cleanPath;
  const fullPath = normalize(join(root, filePath));
  if (!fullPath.startsWith(root)) {
    return null;
  }
  return fullPath;
}

createServer(async (req, res) => {
  const requestUrl = req.url || "/";

  if (requestUrl.startsWith("/api/fetch-prices")) {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const input = await readJsonBody(req);
      const results = await fetchLivePrices(input);
      sendJson(res, 200, {
        collectedAt: new Date().toISOString(),
        mode: "live-public-html",
        results
      });
    } catch (error) {
      sendJson(res, 500, {
        error: "가격 수집 중 오류가 발생했습니다.",
        detail: error.message
      });
    }
    return;
  }

  if (requestUrl.startsWith("/api/health")) {
    sendJson(res, 200, {
      ok: true,
      service: "tire-price-compare",
      timestamp: new Date().toISOString()
    });
    return;
  }

  const fullPath = resolveRequestPath(requestUrl);

  if (!fullPath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(fullPath);
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(fullPath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, () => {
  console.log(`Tire price compare app running at http://localhost:${port}`);
});

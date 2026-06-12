import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fetchLivePrices } from "./src/liveAdapters.js";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const dataDir = join(root, "data");
const jobsDir = join(dataDir, "jobs");
const latestResultsPath = join(dataDir, "latest-results.json");
const automationInputPath = join(dataDir, "automation-input.json");
const automationJobs = new Map();

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

async function writeJsonFile(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function startLocalAutomation(input) {
  await mkdir(jobsDir, { recursive: true });
  const jobId = randomUUID();
  const jobPath = join(jobsDir, `${jobId}.json`);
  const logPath = join(jobsDir, `${jobId}.log`);
  const errPath = join(jobsDir, `${jobId}.err.log`);
  await writeJsonFile(automationInputPath, input);
  await writeJsonFile(jobPath, {
    jobId,
    status: "queued",
    message: "로컬 브라우저 자동화 대기 중",
    outputPath: latestResultsPath,
    updatedAt: new Date().toISOString()
  });

  const child = spawn(process.execPath, ["scripts/localAutomation.js", automationInputPath, latestResultsPath, jobPath], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      TIRE_AUTOMATION_JOB_ID: jobId
    }
  });

  automationJobs.set(jobId, {
    jobId,
    status: "running",
    childPid: child.pid,
    jobPath,
    logPath,
    errPath,
    startedAt: new Date().toISOString()
  });

  child.stdout.on("data", (chunk) => appendLog(logPath, chunk));
  child.stderr.on("data", (chunk) => appendLog(errPath, chunk));
  child.on("exit", (code) => {
    const job = automationJobs.get(jobId);
    if (job) {
      automationJobs.set(jobId, {
        ...job,
        exitedAt: new Date().toISOString(),
        exitCode: code
      });
    }
  });
  child.unref();

  return { jobId, jobPath };
}

async function appendLog(path, chunk) {
  await mkdir(jobsDir, { recursive: true });
  await appendFile(path, chunk).catch(() => {});
}

async function readJobStatus(jobId) {
  const safeJobId = String(jobId || "").replace(/[^a-f0-9-]/gi, "");
  if (!safeJobId) return null;
  const jobPath = join(jobsDir, `${safeJobId}.json`);
  try {
    const fileStatus = await readJsonFile(jobPath);
    return {
      ...automationJobs.get(safeJobId),
      ...fileStatus
    };
  } catch {
    return automationJobs.get(safeJobId) || null;
  }
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
  const parsedUrl = new URL(requestUrl, `http://${req.headers.host || "localhost"}`);

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

  if (requestUrl.startsWith("/api/run-local-automation")) {
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
      const job = await startLocalAutomation(input);
      sendJson(res, 202, {
        jobId: job.jobId,
        status: "running",
        message: "로컬 브라우저 자동화를 시작했습니다. 브라우저 창이 뜨면 닫지 말고 기다려주세요."
      });
    } catch (error) {
      sendJson(res, 500, {
        error: "로컬 자동화 실행 중 오류가 발생했습니다.",
        detail: error.message
      });
    }
    return;
  }

  if (requestUrl.startsWith("/api/automation-status")) {
    const job = await readJobStatus(parsedUrl.searchParams.get("jobId"));
    if (!job) {
      sendJson(res, 404, { error: "작업을 찾을 수 없습니다." });
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  if (requestUrl.startsWith("/api/local-results")) {
    try {
      sendJson(res, 200, await readJsonFile(latestResultsPath));
    } catch (error) {
      sendJson(res, 404, {
        error: "저장된 로컬 자동화 결과가 없습니다.",
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

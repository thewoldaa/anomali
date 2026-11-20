/**
 * server.ts — web chat lokal.
 *   npm run web
 *   npm run web -- --host 0.0.0.0   (bisa dibuka dari HP di wifi yang sama)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Engine } from "./engine.ts";
import { DB_PATH, ROOT } from "./store.ts";

const args = process.argv.slice(2);
function argValue(flag: string, fallback: string): string {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const PORT = Number(argValue("--port", process.env.PORT ?? "7777"));
const HOST = argValue("--host", "127.0.0.1");
const PUBLIC_DIR = path.join(ROOT, "public");

if (!fs.existsSync(DB_PATH)) {
  console.error("Database belum ada. Jalankan dulu:\n  npm run gen\n  npm run build");
  process.exit(1);
}

const engines = new Map<string, Engine>();

function engineFor(user: string): Engine {
  let e = engines.get(user);
  if (!e) {
    e = Engine.open(user);
    engines.set(user, e);
  }
  return e;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error("body terlalu besar"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/profile") {
      const user = url.searchParams.get("user") || "web";
      return json(res, 200, engineFor(user).profile());
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readBody(req);
      const user = String(body.user || "web").slice(0, 64);
      const message = String(body.message ?? "").slice(0, 4000);
      if (!message.trim()) return json(res, 400, { error: "pesan kosong" });
      const reply = engineFor(user).reply(message);
      return json(res, 200, reply);
    }

    if (req.method === "POST" && url.pathname === "/api/reset") {
      const body = await readBody(req);
      const user = String(body.user || "web").slice(0, 64);
      const removed = engineFor(user).reset();
      return json(res, 200, { removed });
    }

    if (req.method === "GET") {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
      const file = path.join(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "forbidden" });
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, {
          "content-type": MIME[ext] ?? "application/octet-stream",
          "cache-control": "no-cache",
        });
        return fs.createReadStream(file).pipe(res);
      }
    }

    json(res, 404, { error: "tidak ada" });
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
});

server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`\n  anomali web chat → http://${shown}:${PORT}\n`);
  if (HOST === "0.0.0.0") {
    console.log("  (host 0.0.0.0 — bisa dibuka dari HP di jaringan yang sama)");
    console.log("  gunakan --host 127.0.0.1 kalau hanya untuk komputer ini\n");
  }
});

process.on("SIGINT", () => {
  for (const e of engines.values()) e.store.close();
  process.exit(0);
});

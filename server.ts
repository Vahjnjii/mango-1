import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import puppeteer from "puppeteer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import os from "os";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const tmpDir = os.tmpdir();
const upload = multer({ dest: path.join(tmpDir, "upload_") });

const DB_FILE = path.join(tmpDir, "projects_db.json");

function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}));
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function saveDB(data: any) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {}
}

async function saveFileFromSource(urlOrBase64: string, outPath: string) {
  if (urlOrBase64.startsWith("data:")) {
    const parts = urlOrBase64.split(";base64,");
    const buffer = Buffer.from((parts[1] || parts[0]).replace(/\s/g, ""), "base64");
    fs.writeFileSync(outPath, buffer);
  } else {
    const res = await fetch(urlOrBase64);
    if (!res.ok) throw new Error(`Download failed`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buffer);
  }
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  const pad = (n: number, z: number) => n.toString().padStart(z, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

async function renderVideoHeadless(projectId: string, script: string, originalScript: string, scenes: any[], audioUrl: string) {
  const db = loadDB();
  db[projectId] = { id: projectId, script, originalScript, scenes, audioUrl, status: "rendering", progress: 5, statusText: "Launching headless hyper-render...", createdAt: Date.now() };
  saveDB(db);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true, // "new" is default now in newer puppeteer
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required',
        '--use-gl=egl' // Hardware acceleration fallback helps with canvas
      ]
    });
    const page = await browser.newPage();
    
    // Pass logs to backend
    page.on('console', msg => console.log('Headless Render Log:', msg.text()));

    await page.exposeFunction('onRenderComplete', async () => {
      console.log(`[Project ${projectId}] Headless render complete!`);
      const finalDb = loadDB();
      if (finalDb[projectId]) {
        finalDb[projectId].status = "ready";
        finalDb[projectId].progress = 100;
        finalDb[projectId].statusText = "Completed!";
        finalDb[projectId].videoUrl = `/api/video/download?projectId=${projectId}`;
        saveDB(finalDb);
      }
      await browser?.close();
    });

    await page.exposeFunction('onRenderError', async (err: string) => {
      console.error(`[Project ${projectId}] Headless render error:`, err);
      const finalDb = loadDB();
      if (finalDb[projectId]) {
        finalDb[projectId].status = "failed";
        finalDb[projectId].progress = 0;
        finalDb[projectId].statusText = `Render failed: ${err}`;
        saveDB(finalDb);
      }
      await browser?.close();
    });

    // Navigate to local headless recorder process
    const port = process.env.PORT || 3000;
    await page.goto(`http://localhost:${port}/?headless-record=${projectId}`, { waitUntil: 'networkidle0', timeout: 0 });

  } catch (err: any) {
    console.error("Puppeteer launch failed:", err);
    if (browser) await browser.close();
    const finalDb = loadDB();
    if (finalDb[projectId]) {
      finalDb[projectId].status = "failed";
      finalDb[projectId].statusText = `Failed: ${err.message}`;
      saveDB(finalDb);
    }
  }
} // <REPLACEMENT_END_MARKER>

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));

  app.post("/api/video/render", upload.fields([{ name: "video", maxCount: 1 }, { name: "audio", maxCount: 1 }]), (req: any, res) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const videoFile = files?.video?.[0];
    const audioFile = files?.audio?.[0];
    if (!videoFile) return res.status(400).json({ error: "No video" });

    const inputPath = videoFile.path;
    const outputPath = path.join(os.tmpdir(), `${videoFile.filename}.mp4`);
    let cmd = ffmpeg(inputPath);
    const opts = ["-c:v libx264", "-preset ultrafast", "-crf 23", "-vf scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt yuv420p", "-movflags +faststart"];

    if (audioFile) {
      cmd = cmd.input(audioFile.path);
      opts.push("-c:a aac", "-b:a 192k", "-map", "0:v:0", "-map", "1:a:0", "-shortest");
    } else {
      opts.push("-c:a copy");
    }

    cmd.outputOptions(opts).save(outputPath)
      .on("end", () => {
        res.download(outputPath, "final_video.mp4", () => {
          fs.unlink(inputPath, () => {});
          if (audioFile) fs.unlink(audioFile.path, () => {});
          fs.unlink(outputPath, () => {});
        });
      })
      .on("error", (err) => {
        res.status(500).json({ error: err.message });
        fs.unlink(inputPath, () => {});
        if (audioFile) fs.unlink(audioFile.path, () => {});
      });
  });

  // Background headless endpoints
  app.post("/api/video/render-backend", (req, res) => {
    const { projectId, script, originalScript, scenes, audioUrl } = req.body;
    if (!projectId || !scenes || !audioUrl) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    renderVideoHeadless(projectId, script, originalScript, scenes, audioUrl);
    return res.json({ success: true, status: "rendering", projectId });
  });

  // Target endpoint for the headless browser to deposit its compiled blob
  app.post("/api/video/upload-render", upload.single('video'), (req, res) => {
    const projectId = req.body.projectId;
    if (req.file && projectId) {
      const targetPath = path.join(os.tmpdir(), `project_${projectId}_output.mp4`);
      fs.renameSync(req.file.path, targetPath);
    }
    res.json({ success: true });
  });

  app.get("/api/video/status", (req, res) => {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: "Missing projectId" });
    const db = loadDB();
    const match = db[projectId as string];
    if (!match) return res.status(404).json({ error: "Not found" });
    return res.json(match);
  });

  app.get("/api/video/projects", (req, res) => {
    const db = loadDB();
    const list = Object.values(db).sort((a: any, b: any) => b.createdAt - a.createdAt);
    return res.json(list);
  });

  app.get("/api/video/download", (req, res) => {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: "Missing projectId" });
    const db = loadDB();
    const match = db[projectId as string];
    if (!match) return res.status(404).json({ error: "Not found" });
    const finalPath = path.join(os.tmpdir(), `project_${projectId}_output.mp4`);
    if (!fs.existsSync(finalPath)) return res.status(404).json({ error: "File not ready" });
    return res.download(finalPath, `flux_video_${projectId}.mp4`);
  });

  const distPath = path.join(process.cwd(), "dist");
  const isProd = process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, "index.html"));
  
  if (!isProd) {
    const vite = await createViteServer({ server: { middlewareMode: true, allowedHosts: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get("*", (req, res) => { res.sendFile(path.join(distPath, "index.html")); });
  }

  const port = process.env.PORT || 3000;
  app.listen(port as number, "0.0.0.0", () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer();

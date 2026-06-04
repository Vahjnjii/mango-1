/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// v1.0.1 - Sidebar & GitHub Pages Fix
import { useState, useRef, useEffect, useMemo, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import * as Mp4Muxer from 'mp4-muxer';
import { 
  Loader2, 
  Sparkles, 
  Download, 
  RefreshCw, 
  Zap, 
  Image as ImageIcon, 
  ArrowRight, 
  Settings, 
  Volume2, 
  Video, 
  Play, 
  Pause,
  Square,
  Clock,
  ChevronDown,
  ChevronLeft,
  PenTool,
  Menu
} from 'lucide-react';
import { Octokit } from '@octokit/rest';
import { CinematicParticle, initParticles, renderFrame } from './renderHelper';

if (typeof document !== 'undefined') {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap';
  document.head.appendChild(link);
}

import { GoogleGenAI, Modality } from "@google/genai";

let _aiInstances: any[] = [];
let currentApiIndex = 0;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const generateContentWithRetry = async (params: any, clientProvidedKeys?: string[]): Promise<any> => {
  let keys = clientProvidedKeys || [];
  if (!keys || keys.length === 0) {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('GEMINI_API_KEYS');
      if (stored) {
        try {
          if (stored.startsWith('[')) {
            keys = JSON.parse(stored);
          } else {
            keys = stored.split(/[,\s\n]+/).map(k => k.trim()).filter(Boolean);
          }
        } catch(e) {
          keys = stored.split(/[,\s\n]+/).map(k => k.trim()).filter(Boolean);
        }
      }
    }
  }

  if (!keys || keys.length === 0) {
    throw new Error("No Gemini API keys found. Please configure them in Settings.");
  }

  let lastError: any = null;
  let attempts = 0;
  while (attempts < keys.length) {
    if (currentApiIndex >= keys.length) {
      currentApiIndex = 0;
    }
      
    const client = new GoogleGenAI({ apiKey: keys[currentApiIndex] });
    const currentAttemptIndex = currentApiIndex;
    currentApiIndex = (currentApiIndex + 1) % keys.length;
    attempts++;
      
    try {
      const res = await client.models.generateContent(params);
      return res;
    } catch (err: any) {
      lastError = err;
      const msg = (typeof err === 'string' ? err : (err.message || JSON.stringify(err) || "")).toLowerCase();
        
      if (msg.includes('quota') || msg.includes('429') || msg.includes('limit') || msg.includes('exhausted')) {
         console.warn(`Key ${currentAttemptIndex} exhausted, rotating...`);
         if (attempts < keys.length) await sleep(2000);
         continue; 
      }
      console.warn(`Key failed (attempt ${attempts}), rotating... Error:`, err);
      if (attempts < keys.length) await sleep(1000);
    }
  }
    
  const errorString = typeof lastError === 'string' ? lastError : (lastError.message || JSON.stringify(lastError));
  throw new Error(`Exhausted all ${keys.length} provided Gemini API keys. Final error: ${errorString}`);
};


interface Scene {
  timestamp: number;
  prompt: string;
  text: string;
  imageUrl?: string;
  blob?: Blob;
}

interface Project {
  id: string;
  userId: string;
  script: string;
  videoUrl?: string; // e.g. from GitHub Release
  createdAt: Date;
  status: 'rendering' | 'ready';
}

const VOICES = [
  { id: 'Charon', name: 'Deep & Resonant (Charon)' },
  { id: 'Puck', name: 'Youthful & Light (Puck)' },
  { id: 'Kore', name: 'Soft & Warm (Kore)' },
  { id: 'Fenrir', name: 'Gravelly & Strong (Fenrir)' },
];

// --- IndexedDB Local Persistence System ---
const LOCAL_DB_NAME = "FluxVideoStudioLocalDB";
const STORE_NAME = "projects_v2"; // use new store name for clean schema

function openProjectDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject("Not running in browser context");
      return;
    }
    const request = indexedDB.open(LOCAL_DB_NAME, 2);
    request.onupgradeneeded = (e) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalProject(project: {
  id: string;
  script: string;
  originalScript: string;
  scenes: Scene[];
  audioUrl?: string | null;
  videoUrl?: string | null;
  createdAt: number;
  status: 'ready' | 'rendering';
}) {
  try {
    // Serialise blob URLs into Base64 for permanent offline storage
    let savedAudio = project.audioUrl;
    if (project.audioUrl && project.audioUrl.startsWith('blob:')) {
      try {
        const response = await fetch(project.audioUrl);
        const blob = await response.blob();
        savedAudio = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn("Could not inline audio blob", e);
      }
    }

    let savedVideo = project.videoUrl;
    if (project.videoUrl && project.videoUrl.startsWith('blob:')) {
      try {
        const response = await fetch(project.videoUrl);
        const blob = await response.blob();
        savedVideo = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn("Could not inline video blob", e);
      }
    }

    // Serialize scenes images
    const serializedScenes = await Promise.all(project.scenes.map(async (scene) => {
      let savedImg = scene.imageUrl;
      if (scene.imageUrl && scene.imageUrl.startsWith('blob:')) {
        try {
          const response = await fetch(scene.imageUrl);
          const blob = await response.blob();
          savedImg = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          console.warn("Could not inline scene img", e);
        }
      }
      return {
        timestamp: scene.timestamp,
        prompt: scene.prompt,
        text: scene.text,
        imageUrl: savedImg
      };
    }));

    const record = {
      id: project.id,
      script: project.script,
      originalScript: project.originalScript,
      scenes: serializedScenes,
      audioUrl: savedAudio,
      videoUrl: savedVideo,
      createdAt: project.createdAt,
      status: project.status
    };

    const db = await openProjectDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(record);
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("IndexedDB save error:", err);
  }
}

async function getLocalProjects(): Promise<any[]> {
  try {
    const db = await openProjectDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("IndexedDB offline DB not initialized or supported yet", err);
    return [];
  }
}

export default function App() {
  // GitHub Auth & Settings State
  const [user, setUser] = useState<any | null>(null);
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [githubTokenInput, setGithubTokenInput] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [dbProjects, setDbProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('lastProjectId');
    }
    return null;
  });

  // Offline/Native Rendering States
  const [isRenderingMP4, setIsRenderingMP4] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);

  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem('lastProjectId', selectedProjectId);
    }
  }, [selectedProjectId]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    setIsSidebarOpen(window.innerWidth >= 1024);
  }, []);

  const [isLoadingProject, setIsLoadingProject] = useState(false);

  useEffect(() => {
    if (selectedProjectId) {
      const loadProjectData = async () => {
        setIsLoadingProject(true);
        setError(null);

        // 1. Check local IndexedDB first for instant loading
        try {
          const locals = await getLocalProjects();
          const match = locals.find(p => p.id === selectedProjectId);
          if (match) {
            setScript(match.script || '');
            setOriginalScript(match.originalScript || match.script || '');
            setScenes(match.scenes || []);
            setAudioUrl(match.audioUrl || null);
            setIsLoadingProject(false);
            console.log("Loaded selected project instantly from Offline Local Store!");
            return;
          }
        } catch (e) {
          console.warn("Local DB lookup failed, trying GitHub:", e);
        }

        // 2. Clear if no GitHub token
        if (!githubToken || !user) {
          setIsLoadingProject(false);
          return;
        }

        const octokit = new Octokit({ auth: githubToken });
        const owner = user.login;
        const repo = 'ai-studio-video-projects';

        try {
          // Fetch script
          const { data: scriptContent } = await octokit.repos.getContent({
            owner, repo, path: `projects/${selectedProjectId}/script.txt`
          }) as any;
          const decodedScript = decodeURIComponent(escape(atob(scriptContent.content)));
          setScript(decodedScript);
          setOriginalScript(decodedScript);

          // Try to fetch metadata for advanced recovery (subtitles, prompts)
          let metadata = null;
          try {
            const { data: metaContent } = await octokit.repos.getContent({
              owner, repo, path: `projects/${selectedProjectId}/metadata.json`
            }) as any;
            metadata = JSON.parse(decodeURIComponent(escape(atob(metaContent.content))));
          } catch (e) {
            console.log("No metadata.json found, falling back to timeline parsing");
          }

          // Fetch timeline
          const { data: timelineContent } = await octokit.repos.getContent({
            owner, repo, path: `projects/${selectedProjectId}/timeline.txt`
          }) as any;
          const timelineLines = decodeURIComponent(escape(atob(timelineContent.content))).split('\n');
          
          // Reconstruct scenes
          const reconstructedScenes: Scene[] = [];
          let currentTimestamp = 0;
          let sceneIdx = 0;
          for (let i = 0; i < timelineLines.length; i++) {
            const line = timelineLines[i];
            if (line.startsWith('file ')) {
              const imgPath = line.replace('file ', '').replace(/'/g, '');
              const { data: imgData } = await octokit.repos.getContent({
                owner, repo, path: `projects/${selectedProjectId}/${imgPath}`
              }) as any;
              
              const durationLine = timelineLines[i+1];
              const duration = durationLine?.startsWith('duration ') ? parseFloat(durationLine.replace('duration ', '')) : 5;
              
              reconstructedScenes.push({
                timestamp: currentTimestamp,
                prompt: metadata?.scenes[sceneIdx]?.prompt || `Scene ${sceneIdx + 1}`,
                text: metadata?.scenes[sceneIdx]?.text || "...",
                imageUrl: `data:image/webp;base64,${imgData.content.replace(/\s/g, '')}`
              });
              currentTimestamp += duration;
              sceneIdx++;
              i++; // Skip duration line
            }
          }
          setScenes(reconstructedScenes);
          
          const { data: audioData } = await octokit.repos.getContent({
            owner, repo, path: `projects/${selectedProjectId}/audio.wav`
          }) as any;
          setAudioUrl(`data:audio/wav;base64,${audioData.content.replace(/\s/g, '')}`);

        } catch (error) {
          console.error("Failed to load project details from GitHub:", error);
        } finally {
          setIsLoadingProject(false);
        }
      };
      
      loadProjectData();
    }
  }, [selectedProjectId, githubToken, user]);

  const [showVoiceSelector, setShowVoiceSelector] = useState(false);

  // Base state
  const [script, setScript] = useState('');
  const [originalScript, setOriginalScript] = useState('');
  const [apiKeysInputText, setApiKeysInputText] = useState('');
  const [imageUrlsInputText, setImageUrlsInputText] = useState('');
  const [saveStatus, setSaveStatus] = useState<{ type: 'idle' | 'saving' | 'success' | 'error', message: string }>({ type: 'idle', message: '' });
  const [selectedVoice, setSelectedVoice] = useState('Charon');
  const [isGenerating, setIsGenerating] = useState(false);
  const [regeneratingIdx, setRegeneratingIdx] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const blobToBase64 = async (blob: Blob): Promise<string> => {
    const arrayBuffer = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(arrayBuffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const resolveUrlToBase64 = async (url: string | null | undefined): Promise<string | null> => {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    if (url.startsWith('blob:')) {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn("Error converting blob URL to base64:", url, e);
        return url;
      }
    }
    return url;
  };

  const uploadProjectToGitHub = async (
    octokit: Octokit,
    userLogin: string,
    timestamp: string,
    audioBase64: string,
    imagesPayload: { filename: string, base64: string }[],
    timelineText: string,
    scriptText: string,
    scenesData: Scene[]
  ) => {
    const owner = userLogin;
    const repo = 'ai-studio-video-projects';
    
    try {
      await octokit.repos.get({ owner, repo });
    } catch (e: any) {
      if (e.status === 404) {
        await octokit.repos.createForAuthenticatedUser({
          name: repo,
          description: 'Projects generated by AI Studio. Rendered automatically via Actions.',
          private: true,
          auto_init: true
        });
        await new Promise(r => setTimeout(r, 2000));
      } else {
        throw e;
      }
    }

    let refSha;
    let baseTreeSha;
    try {
      const { data: ref } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
      refSha = ref.object.sha;
      const { data: commit } = await octokit.git.getCommit({ owner, repo, commit_sha: refSha });
      baseTreeSha = commit.tree.sha;
    } catch (e: any) {
       baseTreeSha = undefined;
    }

    const treeData: any[] = [];
    
    // Generate SRT text
    let srtText = "";
    for (let i = 0; i < scenesData.length; i++) {
        const scene = scenesData[i];
        const nextTimestamp = i < scenesData.length - 1 ? scenesData[i+1].timestamp : scene.timestamp + 5; // guess 5s if last
        
        const formatTime = (seconds: number) => {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = Math.floor(seconds % 60);
            const ms = Math.floor((seconds % 1) * 1000);
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
        };

        // Break text into lines
        const words = scene.text.split(' ');
        let chunks = [];
        for (let j = 0; j < Math.max(1, words.length); j+=4) {
            chunks.push(words.slice(j, j + 4).join(' '));
        }

        // We divide the scene's duration among the text chunks
        const durationPerChunk = (nextTimestamp - scene.timestamp) / Math.max(1, chunks.length);
        
        for (let k = 0; k < chunks.length; k++) {
            const startStr = formatTime(scene.timestamp + (k * durationPerChunk));
            const endStr = formatTime(scene.timestamp + ((k + 1) * durationPerChunk));
            srtText += `${i * 100 + k + 1}\n${startStr} --> ${endStr}\n<font color="#ffc400"><b>${chunks[k]}</b></font>\n\n`;
        }
    }
    const srtBase64 = btoa(unescape(encodeURIComponent(srtText)));
    const { data: srtBlob } = await octokit.git.createBlob({ owner, repo, content: srtBase64, encoding: 'base64' });
    treeData.push({ path: `projects/${timestamp}/subtitles.srt`, mode: '100644', type: 'blob', sha: srtBlob.sha });

    for (const img of imagesPayload) {
      const { data: blob } = await octokit.git.createBlob({ owner, repo, content: img.base64, encoding: 'base64' });
      treeData.push({ path: `projects/${timestamp}/images/${img.filename}`, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const { data: audioBlob } = await octokit.git.createBlob({ owner, repo, content: audioBase64, encoding: 'base64' });
    treeData.push({ path: `projects/${timestamp}/audio.wav`, mode: '100644', type: 'blob', sha: audioBlob.sha });

    const timelineBase64 = btoa(unescape(encodeURIComponent(timelineText)));
    const { data: timelineBlob } = await octokit.git.createBlob({ owner, repo, content: timelineBase64, encoding: 'base64' });
    treeData.push({ path: `projects/${timestamp}/timeline.txt`, mode: '100644', type: 'blob', sha: timelineBlob.sha });

    const scriptBase64 = btoa(unescape(encodeURIComponent(scriptText)));
    const { data: scriptBlob } = await octokit.git.createBlob({ owner, repo, content: scriptBase64, encoding: 'base64' });
    treeData.push({ path: `projects/${timestamp}/script.txt`, mode: '100644', type: 'blob', sha: scriptBlob.sha });

    const metaDataString = JSON.stringify({ scenes: scenesData.map(s => ({ prompt: s.prompt, text: s.text, timestamp: s.timestamp })) });
    const metaBase64 = btoa(unescape(encodeURIComponent(metaDataString)));
    const { data: metaBlob } = await octokit.git.createBlob({ owner, repo, content: metaBase64, encoding: 'base64' });
    treeData.push({ path: `projects/${timestamp}/metadata.json`, mode: '100644', type: 'blob', sha: metaBlob.sha });

    const workflowContent = `name: Render Video

on:
  push:
    paths:
      - 'projects/**/timeline.txt'

permissions:
  contents: write

jobs:
  render:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      
      - name: Setup FFmpeg
        uses: FedericoCarboni/setup-ffmpeg@v3
        
      - name: Render and Release MP4s
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r \${{ github.sha }} || echo "")
          for timeline in $(echo "$CHANGED_FILES" | grep 'timeline.txt' || true); do
            if [ -f "$timeline" ]; then
              dir=$(dirname "$timeline")
              echo "Rendering $dir/output.mp4"
              cd "$dir"
              # First concat images with zoompan and correct 9:16 aspect ratio
              # We use a filter_complex to map each image to a 6-second zoompan, then concat them. 
              # Using a basic scale and subtitles.srt for text
              ffmpeg -f concat -safe 0 -i timeline.txt -i "audio.wav" -c:v libx264 -pix_fmt yuv420p -c:a aac -vf "zoompan=z='min(zoom+0.0005,1.1)' :d=1 :x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,subtitles=subtitles.srt:force_style='FontName=Arial,FontSize=42,PrimaryColour=&H0000D0FF,BorderStyle=3,Outline=4,Shadow=2,MarginV=120'" -shortest output.mp4
              PROJECT_ID=$(basename "$dir")
              cd -
              gh release create "vid-\${PROJECT_ID}" "$dir/output.mp4" --title "Video \${PROJECT_ID}" --notes "Rendered MP4 via Actions" || true
            fi
          done
`;
    const workflowBase64 = btoa(encodeURIComponent(workflowContent).replace(/%([0-9A-F]{2})/g, (m, p1) => String.fromCharCode(parseInt(p1, 16))));
    const { data: workflowBlob } = await octokit.git.createBlob({ owner, repo, content: workflowBase64, encoding: 'base64' });
    treeData.push({ path: `.github/workflows/render.yml`, mode: '100644', type: 'blob', sha: workflowBlob.sha });

    const treeParams: any = { owner, repo, tree: treeData };
    if (baseTreeSha) treeParams.base_tree = baseTreeSha;
    
    const { data: newTree } = await octokit.git.createTree(treeParams);

    const commitParams: any = { owner, repo, message: `Add video project ${timestamp}`, tree: newTree.sha };
    if (refSha) commitParams.parents = [refSha];
    
    const { data: newCommit } = await octokit.git.createCommit(commitParams);

    if (refSha) {
      await octokit.git.updateRef({ owner, repo, ref: 'heads/main', sha: newCommit.sha });
    } else {
      await octokit.git.createRef({ owner, repo, ref: 'refs/heads/main', sha: newCommit.sha });
    }
  };
  
  const [showSettings, setShowSettings] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [showInputBar, setShowInputBar] = useState(true);

  const fetchBackendProjects = async (): Promise<Project[]> => {
    try {
      const resp = await fetch("/api/video/projects");
      if (resp.ok) {
        const list = await resp.json();
        return list.map((item: any) => ({
          id: item.id,
          userId: 'backend',
          script: item.script || 'Background Render',
          videoUrl: item.videoUrl || undefined,
          createdAt: new Date(item.createdAt),
          status: item.status
        }));
      }
    } catch (e) {
      console.warn("Could not fetch backend projects", e);
    }
    return [];
  };

  const fetchProjects = async (octokit: Octokit, userLogin: string) => {
    try {
      const { data: tree } = await octokit.git.getTree({
        owner: userLogin,
        repo: 'ai-studio-video-projects',
        tree_sha: 'main:projects'
      });
      
      const { data: releases } = await octokit.repos.listReleases({
        owner: userLogin,
        repo: 'ai-studio-video-projects',
        per_page: 50
      });
      
      const gitProjects: Project[] = (tree.tree || []).filter(item => item.type === 'tree').map(item => {
        const pId = item.path || '';
        const release = releases.find(r => r.tag_name === `vid-${pId}`);
        const asset = release?.assets.find(a => a.name === 'output.mp4');
        
        return {
           id: pId,
           userId: userLogin,
           script: "Project on GitHub", // Can fetch script.txt if needed
           videoUrl: asset ? asset.browser_download_url : undefined,
           createdAt: new Date(parseInt(pId || "0")),
           status: (asset ? 'ready' : 'rendering') as 'ready' | 'rendering'
        };
      });

      // Load offline/local projects from IndexedDB
      const locals = await getLocalProjects();
      let combined = [...gitProjects];
      
      locals.forEach(l => {
        if (!combined.some(p => p.id === l.id)) {
          combined.push({
            id: l.id,
            userId: 'local',
            script: l.script || 'Local Render',
            videoUrl: l.videoUrl || undefined,
            createdAt: new Date(l.createdAt || Date.now()),
            status: l.status || 'ready'
          });
        } else if (l.videoUrl) {
          // If git project matches local project, preserve the local high quality MP4 url for instant play!
          const matchIdx = combined.findIndex(p => p.id === l.id);
          if (matchIdx !== -1) {
            combined[matchIdx].videoUrl = l.videoUrl;
          }
        }
      });

      // Merge backend background projects
      const backends = await fetchBackendProjects();
      backends.forEach(b => {
        const idx = combined.findIndex(p => p.id === b.id);
        if (idx === -1) {
          combined.push(b);
        } else {
          combined[idx].status = b.status;
          if (b.videoUrl) combined[idx].videoUrl = b.videoUrl;
        }
      });

      combined.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setDbProjects(combined);
      return combined;
    } catch (err) {
      console.log("No projects yet or error fetching, falling back to local database:", err);
      const locals = await getLocalProjects();
      const backends = await fetchBackendProjects();
      
      let combined: Project[] = locals.map(l => ({
        id: l.id,
        userId: 'local',
        script: l.script || 'Local Render',
        videoUrl: l.videoUrl || undefined,
        createdAt: new Date(l.createdAt || Date.now()),
        status: l.status || 'ready'
      }));

      backends.forEach(b => {
        const idx = combined.findIndex(p => p.id === b.id);
        if (idx === -1) {
          combined.push(b);
        } else {
          combined[idx].status = b.status;
          if (b.videoUrl) combined[idx].videoUrl = b.videoUrl;
        }
      });

      combined.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setDbProjects(combined);
      return combined;
    }
  };

  const fetchUserData = async (token: string) => {
    try {
      const octokit = new Octokit({ auth: token });
      const { data: userData } = await octokit.users.getAuthenticated();
      setUser(userData);
      setGithubToken(token);
      localStorage.setItem('GITHUB_TOKEN', token);

      // Fetch Gist settings
      const { data: gists } = await octokit.gists.list();
      const settingsGist = gists.find(g => g.description === 'AI Studio Video Settings');
      if (settingsGist) {
        // We no longer load settings from gist as they are backend protected
      }

      // Fetch Projects mapping
      await fetchProjects(octokit, userData.login);
    } catch (e) {
      console.error(e);
    } finally {
      setIsAuthLoading(false);
    }
  };

  useEffect(() => {
    let interval: any;
    if (githubToken && user) {
       interval = setInterval(() => {
          if (dbProjects.some(p => p.status === 'rendering')) {
             const o = new Octokit({ auth: githubToken });
             fetchProjects(o, user.login);
          }
       }, 15000); // Check every 15s if we have rendering projects
    }
    return () => clearInterval(interval);
  }, [githubToken, user, dbProjects]);

  useEffect(() => {
    // Load local settings first
    const localKeys = localStorage.getItem('GEMINI_API_KEYS');
    if (localKeys) {
      try {
        const parsed = JSON.parse(localKeys);
        setApiKeys(parsed);
        setApiKeysInputText(parsed.join(', \n'));
      } catch(e) {}
    }
    
    const localUrls = localStorage.getItem('IMAGE_WORKER_URLS');
    if (localUrls) {
      const urlsArray = localUrls.split(',').filter(Boolean);
      setImageUrls(urlsArray);
      setImageUrlsInputText(urlsArray.join(', \n'));
    }

    const storedToken = localStorage.getItem('GITHUB_TOKEN');
    if (storedToken) {
      fetchUserData(storedToken);
    } else {
      setIsAuthLoading(false);
      // Initialize offline / local project list
      const initLocalProjects = async () => {
        const locals = await getLocalProjects();
        const backends = await fetchBackendProjects();
        
        let combined: Project[] = locals.map(l => ({
          id: l.id,
          userId: 'local',
          script: l.script || 'Local Render',
          videoUrl: l.videoUrl || undefined,
          createdAt: new Date(l.createdAt || Date.now()),
          status: l.status || 'ready'
        }));

        backends.forEach(b => {
          const idx = combined.findIndex(p => p.id === b.id);
          if (idx === -1) {
            combined.push(b);
          } else {
            combined[idx].status = b.status;
            if (b.videoUrl) combined[idx].videoUrl = b.videoUrl;
          }
        });

        combined.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setDbProjects(combined as Project[]);
      };
      initLocalProjects();
    }
  }, []);

  // Poll rendering projects in the background cleanly across page sessions
  useEffect(() => {
    const renderingProjects = dbProjects.filter(p => p.status === 'rendering');
    if (renderingProjects.length === 0) return;

    const interval = setInterval(async () => {
      let changed = false;
      const updatedProjects = await Promise.all(dbProjects.map(async (p) => {
        if (p.status === 'rendering') {
          try {
            const resp = await fetch(`/api/video/status?projectId=${p.id}`);
            if (resp.ok) {
              const data = await resp.json();
              
              // Synchronise real-time rendering states for active active project selection
              if (p.id === selectedProjectId) {
                setRenderProgress(data.progress || 0);
                setStatus(data.statusText || 'Rendering...');
              }

              if (data.status === 'ready') {
                changed = true;

                // Sync status to local IndexedDB store
                try {
                  const db = await openProjectDB();
                  const tx = db.transaction(STORE_NAME, "readwrite");
                  const store = tx.objectStore(STORE_NAME);
                  const dbReq = store.get(p.id);
                  dbReq.onsuccess = () => {
                    const existing = dbReq.result;
                    if (existing) {
                      existing.status = 'ready';
                      existing.videoUrl = data.videoUrl;
                      
                      // Perform save in New connection scope if current one is finished
                      try {
                        const saveTx = db.transaction(STORE_NAME, "readwrite");
                        saveTx.objectStore(STORE_NAME).put(existing);
                      } catch (e) {
                        // Fallback to full project save if needed
                        saveLocalProject(existing);
                      }
                    }
                  };
                } catch (dbErr) {
                  console.warn("Could not sync IndexedDB on ready:", dbErr);
                }

                // If currently selected, trigger prompt download
                if (p.id === selectedProjectId) {
                  setIsRenderingMP4(false);
                  try {
                    // Auto-download removed from global background listener
                  } catch (e) {
                    console.warn("Auto-download trigger failed:", e);
                  }
                }

                return { ...p, status: 'ready', videoUrl: data.videoUrl };
              } else if (data.status === 'failed') {
                changed = true;
                if (p.id === selectedProjectId) {
                  setIsRenderingMP4(false);
                  setStatus("Render failed.");
                }
                return { ...p, status: 'ready' }; // clean state so they can click render again
              }
            }
          } catch (e) {
            console.warn("Error polling status for project", p.id, e);
          }
        }
        return p;
      }));

      if (changed) {
        setDbProjects(updatedProjects as Project[]);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [dbProjects, selectedProjectId]);

  const handleLoginWithToken = async (e: FormEvent) => {
    e.preventDefault();
    if (!githubTokenInput) return;
    setIsAuthLoading(true);
    try {
      await fetchUserData(githubTokenInput);
    } catch(e) {
      setSaveStatus({ type: 'error', message: "Invalid GitHub Token or Missing Scopes" });
      setIsAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('GITHUB_TOKEN');
    setGithubToken(null);
    setUser(null);
    setApiKeys([]);
    setImageUrls([]);
    setApiKeysInputText('');
    setImageUrlsInputText('');
    setSaveStatus({ type: 'idle', message: '' });
    setDbProjects([]);
  };

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestRef = useRef<number>(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const activeSceneIndex = useMemo(() => {
    let activeIdx = scenes.length - 1;
    for (let i = 0; i < scenes.length; i++) {
      if (currentTime >= scenes[i].timestamp && (i === scenes.length - 1 || currentTime < scenes[i + 1].timestamp)) {
        activeIdx = i;
        break;
      }
    }
    return Math.max(0, activeIdx);
  }, [currentTime, scenes]);

  useEffect(() => {
    if (stripRef.current && scenes.length > 0 && activeSceneIndex >= 0) {
      const activeChild = stripRef.current.children[activeSceneIndex] as HTMLElement;
      if (activeChild) {
        const strip = stripRef.current;
        const scrollLeft = activeChild.offsetLeft - (strip.clientWidth / 2) + (activeChild.clientWidth / 2);
        strip.scrollTo({ left: scrollLeft, behavior: 'smooth' });
      }
    }
  }, [activeSceneIndex, scenes.length]);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const targetHeight = isFocused ? Math.max(120, scrollHeight) : scrollHeight;
      textareaRef.current.style.height = `${Math.min(targetHeight, 300)}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [script, isFocused]);

  // Constants for 9:16 video
  const CANVAS_WIDTH = 1080;
  const CANVAS_HEIGHT = 1920;

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onended = () => {
        setIsPlaying(false);
        setCurrentTime(0);
      };
      audioRef.current.ontimeupdate = () => {
        const time = audioRef.current?.currentTime || 0;
        setCurrentTime(time);
        
        // Sync timeline scroll
        if (timelineRef.current && duration > 0) {
          const scrollWidth = timelineRef.current.scrollWidth - timelineRef.current.clientWidth;
          timelineRef.current.scrollLeft = (time / duration) * scrollWidth;
        }
      };
    }
  }, [audioUrl, duration]);

  const generateVoiceover = async (targetScript: string): Promise<{duration: number, base64: string}> => {
    setStatus('Synthesizing voice...');
    const ttsResponse = await generateContentWithRetry({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: targetScript }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: selectedVoice }, 
          },
        },
      },
    }, apiKeys);

    const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
    if (!base64Audio) throw new Error("Voiceover failed.");

    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = pcmToWav(bytes, 24000);
    const tempUrl = URL.createObjectURL(blob);
    
    // We can still set audio url for local preview if needed
    setAudioUrl(tempUrl);

    const tempAudio = new Audio(tempUrl);
    await new Promise((resolve, reject) => {
      tempAudio.onloadedmetadata = () => {
        setDuration(tempAudio.duration);
        resolve(null);
      };
      tempAudio.onerror = () => reject(new Error("Audio load failed"));
    });
    
    // Actually we need to return the base64 of the WAV, not the raw PCM base64 returned by gemini
    // So we convert the blob to base64
    const wavBase64 = await blobToBase64(blob);

    return { duration: tempAudio.duration, base64: wavBase64 };
  };

  const createAtmosphere = (audioCtx: BaseAudioContext, destination: AudioNode, offlineDuration?: number) => {
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.05; 

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500; 
    masterGain.connect(filter);
    filter.connect(destination);

    // Deep dissonant drone oscillators
    const frequencies = [42, 43.5, 61, 63, 31]; 
    const oscillators: OscillatorNode[] = [];

    frequencies.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      
      osc.type = i % 2 === 0 ? 'sine' : 'sawtooth';
      osc.frequency.value = freq;
      
      g.gain.setValueAtTime(0.12, 0); // use 0 for base time since it's absolute
      
      const lfo = audioCtx.createOscillator();
      const lfoGain = audioCtx.createGain();
      lfo.frequency.value = 0.1 + Math.random() * 0.1;
      lfoGain.gain.value = 0.4;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      
      osc.connect(g);
      g.connect(masterGain);
      
      osc.start(0);
      lfo.start(0);
      oscillators.push(osc);
    });

    let pingInterval: any;

    if (offlineDuration) {
      // Ahead-of-time scheduling for offline rendering
      for (let t = 0; t < offlineDuration; t += 6) {
        const ping = audioCtx.createOscillator();
        const pGain = audioCtx.createGain();
        ping.type = 'sine';
        ping.frequency.value = 1000 + Math.random() * 1500;
        
        pGain.gain.setValueAtTime(0, t);
        pGain.gain.linearRampToValueAtTime(0.015, t + 0.5);
        pGain.gain.exponentialRampToValueAtTime(0.001, t + 6);
        
        ping.connect(pGain);
        pGain.connect(filter);
        ping.start(t);
        ping.stop(t + 6);
      }
    } else {
      // Realtime interval
      pingInterval = setInterval(() => {
        if (audioCtx.state === 'running') {
          const ping = audioCtx.createOscillator();
          const pGain = audioCtx.createGain();
          ping.type = 'sine';
          ping.frequency.value = 1000 + Math.random() * 1500;
          
          pGain.gain.setValueAtTime(0, audioCtx.currentTime);
          pGain.gain.linearRampToValueAtTime(0.015, audioCtx.currentTime + 0.5);
          pGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 6);
          
          ping.connect(pGain);
          pGain.connect(filter);
          ping.start();
          ping.stop(audioCtx.currentTime + 6);
        }
      }, 6000);
    }

    return {
      stop: () => {
        if (pingInterval) clearInterval(pingInterval);
        oscillators.forEach(o => {
          try { o.stop(); } catch(e) {}
        });
        masterGain.disconnect();
      }
    };
  };

  const handlePlay = async () => {
    if (!audioRef.current) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      if (!sourceNodeRef.current && audioRef.current) {
        try {
          sourceNodeRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
        } catch (e) {
          console.warn("Source already connected");
        }
      }

      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.connect(audioContextRef.current.destination);
        } catch (e) {}
      }

      await audioRef.current.play();
      setIsPlaying(true);
      
      if (audioContextRef.current) {
        const atmosphere = createAtmosphere(audioContextRef.current, audioContextRef.current.destination);
        (window as any)._previewAtmosphere = atmosphere;
      }
    } catch (err) {
      console.error("Playback failed:", err);
    }
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    
    if ((window as any)._previewAtmosphere) {
      (window as any)._previewAtmosphere.stop();
      (window as any)._previewAtmosphere = null;
    }
  };

  const headlessTriggeredRef = useRef(false);
  useEffect(() => {
    if ((window as any).isHeadless && scenes.length > 0 && !isGenerating && !isPlaying && audioUrl && !isRenderingMP4 && !headlessTriggeredRef.current) {
      headlessTriggeredRef.current = true;
      handleRecordVideo();
    }
  }, [scenes, isGenerating, isPlaying, audioUrl, isRenderingMP4]);

  const getSupportedMimeType = () => {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4;codecs=h264,aac',
      'video/mp4'
    ];
    for (const t of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return '';
  };

  const handleRecordVideo = async () => {
    if (!audioUrl || isRenderingMP4) return;
    
    const projectId = selectedProjectId || `p-${Date.now()}`;
    setIsRenderingMP4(true);
    setRenderProgress(0);
    setStatus('Dispatching task to backend rendering server...');

    try {
      handleStop();

      // Convert audio blob to base64
      let audioBase64 = audioUrl;
      const resp = await fetch(audioUrl);
      const audioBlob = await resp.blob();
      audioBase64 = await new Promise((resolve) => {
         const reader = new FileReader();
         reader.onloadend = () => resolve(reader.result as string);
         reader.readAsDataURL(audioBlob);
      });

      // Convert image blobs to base64
      const backendScenes = await Promise.all(scenes.map(async (sc) => {
        let scImageUrl = sc.imageUrl;
        if (scImageUrl) {
           const scResp = await fetch(scImageUrl);
           const scBlob = await scResp.blob();
           scImageUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(scBlob);
           });
        }
        return {
          ...sc,
          imageUrl: scImageUrl,
          blob: undefined // strip blob object
        };
      }));

      const payload = {
        projectId,
        script: script || originalScript || "My Project Script",
        originalScript,
        scenes: backendScenes,
        audioUrl: audioBase64
      };

      const res = await fetch('/api/video/render-backend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        throw new Error("Failed to start backend rendering.");
      }

      // Pre-emptively add/update to local DB so polling works instantly
      await saveLocalProject({
          id: projectId,
          script: payload.script,
          originalScript,
          scenes: backendScenes, // base64 payload is saved locally
          createdAt: Date.now(),
          status: 'rendering'
      });

      setDbProjects(prev => {
        const exists = prev.find(p => p.id === projectId);
        if (exists) {
          return prev.map(p => p.id === projectId ? { ...p, status: 'rendering', progress: 0 } : p);
        }
        return [{ id: projectId, script: payload.script, status: 'rendering', progress: 0, createdAt: Date.now() }, ...prev];
      });

      setStatus("Rendering sent to background! You can safely close or switch tabs.");
      
      // Auto-trigger the polling if not already running
      // The useEffect with setInterval already watches dbProjects status === 'rendering'!
      
    } catch (err: any) {
      console.error("Backend dispatch failed:", err);
      setStatus("Render dispatch failed: " + err.message);
    } finally {
      setIsRenderingMP4(false);
    }
  };

  const handlePause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    
    if ((window as any)._previewAtmosphere) {
      (window as any)._previewAtmosphere.stop();
      (window as any)._previewAtmosphere = null;
    }
  };

  const togglePlay = () => {
    if (isPlaying) handlePause();
    else handlePlay();
  };
  const sanitizePrompt = (p: string) => {
    // Filter to remove words that heavily trigger NSFW filters (sexual, gore, etc.)
    // We allow artistic words like 'darkness', 'shadow', 'ominous' now as requested for the tone.
    const restricted = [
      'blood', 'gore', 'naked', 'sexual', 'porn', 'violence', 'death', 'kill', 'murder', 'suicide', 
      'genitals', 'breast', 'penis', 'vagina', 'abuse', 'hit', 'smash', 'crush', 'weapon', 
      'gun', 'knife', 'sharp', 'toxic', 'poison', 'harm', 'bleed', 'slay', 'dead', 'knife', 
      'cut', 'wound', 'suffering', 'agony'
    ];
    let sanitized = p.toLowerCase();
    restricted.forEach(word => {
      sanitized = sanitized.split(word).join('intense');
    });
    // Remove characters that might break prompts
    sanitized = sanitized.replace(/[^\w\s,]/gi, ' ');
    return sanitized.substring(0, 500); 
  };

  const generateImageFromProviders = async (prompt: string): Promise<Blob> => {
    let workerUrls = imageUrls;
    const storedUrls = typeof window !== 'undefined' ? localStorage.getItem('IMAGE_WORKER_URLS') : null;
    
    if (storedUrls) {
      try {
        if (storedUrls.startsWith('[')) {
          workerUrls = JSON.parse(storedUrls);
        } else {
          workerUrls = storedUrls.split(/[,\s\n]+/).map(u => u.trim()).filter(Boolean);
        }
      } catch (e) {
        workerUrls = storedUrls.split(/[,\s\n]+/).map(u => u.trim()).filter(Boolean);
      }
    }

    if (!workerUrls || workerUrls.length === 0) {
      workerUrls = [
        "https://flux1.shreevathsa2k27.workers.dev/",
        "https://flux.shreevathsa2k21-4fa.workers.dev/",
        "https://flux.vaishakhaphotos2.workers.dev/",
        "https://flux.vmajibail.workers.dev/"
      ];
    }

    const shuffledUrls = [...workerUrls].sort(() => Math.random() - 0.5);

    let lastError = null;

    for (const workerUrl of shuffledUrls) {
      try {
        console.log(`[Flux Proxy Frontend] Trying URL: ${workerUrl}`);
        const response = await fetch(workerUrl.trim(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
          signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Flux Frontend Error] ${workerUrl}:`, response.status, errorText);
          
          if (response.status === 429 || response.status >= 500) {
            lastError = { status: response.status, text: errorText };
            continue;
          }
          throw new Error(errorText || `HTTP ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        let uintArray = new Uint8Array(arrayBuffer);

        if (uintArray[0] === 123) {
          const textData = new TextDecoder("utf-8").decode(uintArray);
          try {
            const json = JSON.parse(textData);
            const b64 = json.image || json.result?.image || json.img;
            if (b64) {
              const base64Data = b64.replace(/^data:image\/\w+;base64,/, "");
              const binStr = atob(base64Data);
              const binArr = new Uint8Array(binStr.length);
              for (let i = 0; i < binStr.length; i++) {
                binArr[i] = binStr.charCodeAt(i);
              }
              return new Blob([binArr], { type: "image/jpeg" });
            }
          } catch (e) {
            console.error("JSON parse failed", e);
          }
        }
        
        return new Blob([arrayBuffer], { type: "image/jpeg" });

      } catch (error: any) {
        console.error(`[Flux Proxy Exception] ${workerUrl}:`, error.message);
        lastError = { status: 500, text: error.message };
        continue;
      }
    }

    try {
      console.log(`[Flux Frontend] Using Pollinations fallback`);
      const response = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=720&height=1280&nologo=true`, {
        signal: AbortSignal.timeout(15000)
      });
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        return new Blob([arrayBuffer], { type: "image/jpeg" });
      }
    } catch (e) {
      console.error("[Flux Proxy] Pollinations fallback failed:", e);
    }

    throw new Error(lastError?.text || "All workers failed");
  };

  const regenerateImage = async (index: number) => {
    const scene = scenes[index];
    if (!scene) return;

    setRegeneratingIdx(index);
    setStatus(`Updating frame ${index + 1}...`);
    
    let attempts = 0;
    let success = false;
    let lastErr = '';

    while (attempts < 3 && !success) {
      try {
        const sanitizedScenePrompt = sanitizePrompt(scene.prompt);
        const fullPrompt = `Deeply dark psychological anime/manga style, heart-touching human vulnerability, cinematic composition, ${sanitizedScenePrompt}, masterpiece, high quality, expressive shadows, soulful atmosphere, no text.`;
        const blob = await generateImageFromProviders(fullPrompt);
        const url = URL.createObjectURL(blob);
        
        setScenes(prev => {
          const next = [...prev];
          if (next[index].imageUrl) URL.revokeObjectURL(next[index].imageUrl!);
          next[index] = { ...next[index], imageUrl: url };
          return next;
        });
        setStatus('Frame updated');
        success = true;
      } catch (err: any) {
        attempts++;
        lastErr = err.message;
        console.warn(`Attempt ${attempts} failed for scene ${index}:`, err);
        setStatus(`Retrying frame ${index + 1} (${attempts}/3)...`);
      }
    }

    if (!success) {
      setError(`Failed to regenerate after 3 attempts: ${lastErr}`);
    }
    setRegeneratingIdx(null);
  };

  const generateFullVideo = async (providedScript?: string) => {
    // Unban/unlock AudioContext directly on the user's initial click gesture!
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
    } catch (e) {
      console.warn("Could not pre-init AudioContext:", e);
    }

    const textToUse = providedScript || script;
    if (!textToUse.trim()) {
      setError('Enter a script first.');
      return;
    }

    setOriginalScript(textToUse);
    setScript('');
    setShowInputBar(false);
    setIsGenerating(true);
    setError(null);
    setProgress(0);

    try {
      const { duration: audioDuration, base64: audioBase64 } = await generateVoiceover(textToUse);
      setStatus('Planning story based on audio duration...');
      
      const planResponse = await generateContentWithRetry({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: textToUse }] }],
        config: {
          systemInstruction: `You are a cinematic video producer. Divide the provided script into MANY small chronological segments of roughly 6 seconds each to ensure visual variety, matching the total duration of ${audioDuration.toFixed(1)} seconds.
          
          For each segment, you must provide:
          1. "timestamp": The calculated start time in seconds.
          2. "prompt": A deeply emotional, dark psychological anime style prompt focusing on "heart-touching" human vulnerability.
             CRITICAL: Each image must be visually unique. Avoid generic background repetitions.
          3. "text": The EXACT portion of the script corresponding to this timeframe.
          
          Output as a clean JSON array of objects. No extra text or explanations.`,
          responseMimeType: "application/json",
        }
      }, apiKeys);

      let text = planResponse.text;
      if (!text) throw new Error("Planning failed.");

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) text = jsonMatch[0];

      const parsedPlan = JSON.parse(text);
      if (!Array.isArray(parsedPlan)) throw new Error("Invalid plan format");

      const PAUSE_DUR = 0.5;
      const WORD_DUR = 0.3;
      
      const baseDurations = parsedPlan.map(s => {
        const wordCount = (s.text || "").split(/\s+/).length;
        return (wordCount * WORD_DUR) + PAUSE_DUR;
      });
      
      const totalBaseDuration = baseDurations.reduce((a, b) => a + b, 0);
      const scale = audioDuration / (totalBaseDuration || 1);
      
      let runningTime = 0;
      const scenePlan: Scene[] = parsedPlan.map((s, i) => {
        const startTime = runningTime;
        runningTime += baseDurations[i] * scale;
        return {
          ...s,
          timestamp: startTime,
          prompt: s.prompt || "Cinematic atmosphere",
          text: s.text || ""
        };
      });

      setScenes(scenePlan);
      setStatus('Painting scenes...');
      
      let completed = 0;
      const gatheredBlobs: (Blob | null)[] = new Array(scenePlan.length).fill(null);
      
      const imagePromises = scenePlan.map(async (scene, i) => {
        let attempts = 0;
        let success = false;
        
        while (attempts < 3 && !success) {
          try {
            const sanitizedScenePrompt = sanitizePrompt(scene.prompt);
            const fullPrompt = `Deeply dark psychological anime/manga style, heart-touching human vulnerability, cinematic composition, ${sanitizedScenePrompt}, masterpiece, high quality, expressive shadows, soulful atmosphere, no text.`;
            const blob = await generateImageFromProviders(fullPrompt);
            const url = URL.createObjectURL(blob);
            
            gatheredBlobs[i] = blob;
            setScenes(prev => {
              const next = [...prev];
              next[i] = { ...next[i], imageUrl: url, blob };
              return next;
            });
            success = true;
          } catch (err) {
            attempts++;
            console.warn(`Scene ${i} attempt ${attempts} failed:`, err);
            if (attempts >= 3) break;
          }
        }
        
        completed++;
        setProgress((completed / scenePlan.length) * 100);
        return success;
      });

      await Promise.all(imagePromises);

      setStatus('Images ready! Starting exact preview render recording... DO NOT SWITCH TABS');
      setIsGenerating(false);
      setProgress(100);
      
      setTimeout(() => {
        handleRecordVideo();
      }, 500);
      
    } catch (err: any) {
      setError(err.message || 'Workflow error');
      setIsGenerating(false);
    }
  };

  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const particlesRef = useRef<CinematicParticle[]>([]);

  // Initialize particles once
  const initParticlesApp = () => {
    particlesRef.current = initParticles();
  };

  const pcmToWav = (pcmData: Uint8Array, sampleRate: number = 24000) => {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmData.length;
    const totalSize = 44 + dataSize;
    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);
    view.setUint32(0, 0x52494646, false);
    view.setUint32(4, totalSize - 8, true);
    view.setUint32(8, 0x57415645, false);
    view.setUint32(12, 0x666d7420, false);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    view.setUint32(36, 0x64617461, false);
    view.setUint32(40, dataSize, true);
    new Uint8Array(arrayBuffer, 44).set(pcmData);
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!imageElementRef.current) imageElementRef.current = new Image();
    const img = imageElementRef.current;
    
    // Ensure particles are initialized
    if (particlesRef.current.length === 0) initParticlesApp();

    const render = (time: number) => {
      if (!ctx || scenes.length === 0) return;
      
      const audioTime = audioRef.current?.currentTime || 0;
      
      renderFrame(
        ctx, 
        CANVAS_WIDTH, 
        CANVAS_HEIGHT, 
        time, 
        audioTime, 
        duration, 
        scenes, 
        null, 
        imageElementRef as { current: HTMLImageElement | null }, 
        particlesRef.current, 
        isPlaying, 
        isGenerating
      );

      requestRef.current = requestAnimationFrame(render);
    };
    requestRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(requestRef.current);
  }, [scenes, currentTime, isGenerating]);

  return (
    <div className="h-[100dvh] flex bg-[#050505] text-zinc-200 font-sans overflow-hidden">
      <audio ref={audioRef} src={audioUrl || undefined} />

      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isMobile && isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.div 
            initial={isMobile ? { x: '-100%' } : { width: 0, opacity: 0 }}
            animate={isMobile ? { x: 0 } : { width: 260, opacity: 1 }}
            exit={isMobile ? { x: '-100%' } : { width: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 150 }}
            className={`flex-shrink-0 bg-zinc-950 border-r border-zinc-800/50 flex flex-col h-full z-[110] overflow-hidden ${isMobile ? 'fixed inset-y-0 left-0 w-[280px]' : 'relative'}`}
          >
            <div className="p-3 flex items-center justify-between">
              <button 
                onClick={() => {
                  setOriginalScript('');
                  setScript('');
                  setScenes([]);
                  setAudioUrl(null);
                  setCurrentTime(0);
                  setIsGenerating(false);
                  setShowInputBar(true);
                  setSelectedProjectId(null);
                  if (isMobile) setIsSidebarOpen(false);
                }}
                className="flex-1 flex justify-between items-center gap-2 bg-transparent hover:bg-zinc-900 border border-zinc-800 text-zinc-300 px-3 py-2 rounded-lg text-sm transition-colors mr-2"
               >
                 <span className="font-bold">New Video</span>
                 <PenTool size={14} className="text-orange-500" />
              </button>
              {isMobile && (
                 <button onClick={() => setIsSidebarOpen(false)} className="p-2 text-zinc-500 hover:text-white">
                   ✕
                 </button>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar px-2 space-y-1">
               <div className="text-xs font-bold text-zinc-600 px-2 my-2 uppercase tracking-wider">History</div>
               {dbProjects.length === 0 && (
                  <div className="text-xs text-zinc-500 px-2 italic">Nothing here yet...</div>
               )}
               {dbProjects.map((p) => (
                  <div key={p.id} className={`w-full text-left bg-transparent ${selectedProjectId === p.id ? 'bg-zinc-900 border-zinc-800 ring-1 ring-orange-500/20' : 'hover:bg-zinc-900/50 border-transparent'} border p-2.5 rounded-lg transition-all flex items-center justify-between group cursor-pointer`} onClick={() => {
                      setSelectedProjectId(p.id);
                      if (isMobile) setIsSidebarOpen(false);
                  }}>
                    <div className="flex flex-col truncate pr-2 flex-1">
                       {editingProjectId === p.id ? (
                         <input
                           autoFocus
                           className="bg-zinc-950 border border-orange-500/50 text-white text-sm px-1.5 py-0.5 rounded outline-none w-full shadow-inner"
                           value={editingTitle}
                           onChange={(e) => setEditingTitle(e.target.value)}
                           onBlur={() => {
                             if (editingTitle.trim()) {
                               setDbProjects(prev => prev.map(proj => proj.id === p.id ? { ...proj, script: editingTitle } : proj));
                             }
                             setEditingProjectId(null);
                           }}
                           onKeyDown={(e) => {
                             if (e.key === 'Enter') {
                               if (editingTitle.trim()) {
                                 setDbProjects(prev => prev.map(proj => proj.id === p.id ? { ...proj, script: editingTitle } : proj));
                               }
                               setEditingProjectId(null);
                             }
                             if (e.key === 'Escape') setEditingProjectId(null);
                           }}
                           onClick={(e) => e.stopPropagation()}
                         />
                       ) : (
                         <>
                           <span className="text-sm text-zinc-300 truncate font-medium">
                             {p.script.startsWith('Project ') ? `Video ${p.id.slice(-4)}` : p.script}
                           </span>
                           <span className="text-[10px] flex items-center gap-1 mt-1 font-mono uppercase tracking-tighter">
                              {p.status === 'rendering' ? (
                                <span className="text-orange-500 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Rendering...</span>
                              ) : (
                                <span className="text-emerald-500/70 flex items-center gap-1"><Video size={10} /> Ready</span>
                              )}
                           </span>
                         </>
                       )}
                    </div>
                    {!editingProjectId && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingProjectId(p.id);
                          setEditingTitle(p.script.startsWith('Project ') ? `Video ${p.id.slice(-4)}` : p.script);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 hover:text-orange-500 text-zinc-600 transition-all rounded hover:bg-white/5"
                      >
                        <PenTool size={12} />
                      </button>
                    )}
                  </div>
               ))}
            </div>

            <div className="p-3 border-t border-zinc-800/50">
               <button 
                 onClick={() => {
                   setShowSettings(!showSettings);
                   if (isMobile) setIsSidebarOpen(false);
                 }}
                 className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 text-sm w-full p-2.5 rounded-lg hover:bg-zinc-900 transition-colors"
               >
                 <Settings size={16} />
                 Settings
               </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header Bar */}
        <header className="shrink-0 h-14 border-b border-zinc-800/50 px-2 sm:px-4 flex items-center justify-between bg-zinc-950 z-30">
          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            <AnimatePresence>
              {!isSidebarOpen && (
                <motion.button 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => setIsSidebarOpen(true)} 
                  className="p-1.5 sm:p-2 text-zinc-400 hover:text-white transition-colors bg-zinc-900/50 rounded-lg border border-zinc-800"
                >
                  <Menu size={16} className="sm:w-[18px] sm:h-[18px]" />
                </motion.button>
              )}
            </AnimatePresence>
            
            <div className="w-5 h-5 sm:w-6 sm:h-6 bg-orange-500 rounded flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Video size={11} className="text-black sm:w-3.5 sm:h-3.5" />
            </div>
            <h1 className="text-[10px] font-bold uppercase tracking-[0.2em] hidden sm:block">Flux <span className="text-orange-500 text-opacity-80">Video Studio</span></h1>
          </div>

           <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
             {/* If we have a compiled video URL on the selected project or local, show Download button */}
             {selectedProjectId && dbProjects.find(p => p.id === selectedProjectId)?.videoUrl && (
               <button
                 onClick={() => {
                   const url = dbProjects.find(p => p.id === selectedProjectId)?.videoUrl;
                   if (url) {
                     window.location.href = url;
                   }
                 }}
                 className="flex items-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[10px] sm:text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg border border-zinc-800 transition-colors whitespace-nowrap"
                 title="Download Converted MP4"
               >
                 <Download size={13} className="text-orange-500" />
                 <span className="hidden xs:inline">Download MP4</span>
               </button>
             )}

             {/* Inline Rendering progress inside the header bar itself */}
             {(isRenderingMP4 || dbProjects.find(p => p.id === selectedProjectId)?.status === 'rendering') && (
               <div className="flex items-center gap-2 sm:gap-3 bg-orange-500/10 border border-orange-500/15 px-2 py-1 rounded-lg shrink-0 animate-pulse">
                 <Loader2 className="animate-spin text-orange-500 shrink-0" size={13} />
                 <span className="text-[10px] font-mono text-orange-400 font-bold hidden md:inline uppercase tracking-wider">Rendering:</span>
                 <div className="w-16 sm:w-28 h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
                   <div 
                     className="h-full bg-gradient-to-r from-orange-600 to-orange-400 transition-all duration-150"
                     style={{ width: `${renderProgress}%` }}
                   />
                 </div>
                 <span className="text-[10px] font-mono text-zinc-300 font-bold">{renderProgress}%</span>
               </div>
             )}

             {/* Manual Render button */}
             {scenes.length > 0 && !isGenerating && !isPlaying && !(isRenderingMP4 || dbProjects.find(p => p.id === selectedProjectId)?.status === 'rendering') && (
               <button
                 onClick={handleRecordVideo}
                 className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-black text-[10px] sm:text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:scale-[1.02] shadow-[0_0_10px_rgba(249,115,22,0.2)] whitespace-nowrap"
                 title="Render to final MP4 exact timing"
               >
                 <Video size={13} />
                 <span>Render MP4</span>
               </button>
             )}

             {isGenerating && (
               <div className="flex items-center gap-2 max-w-[80px] sm:max-w-[120px]">
                 <div className="h-1.5 w-12 sm:w-20 bg-zinc-900 rounded-full overflow-hidden">
                   <motion.div className="h-full bg-orange-500" animate={{ width: `${progress}%` }} />
                 </div>
               </div>
             )}
             
             <div className="hidden md:block text-[10px] font-mono text-zinc-500 bg-zinc-900/50 px-2 py-1 rounded-full border border-zinc-800/50 max-w-[150px] truncate" title={status || 'Idle'}>
               {status || 'Idle'}
             </div>
           </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 flex flex-col items-center justify-center min-h-0 relative p-2 sm:px-4 sm:py-2 gap-2 w-full max-w-2xl mx-auto">

        
        <div className="relative flex-1 w-full min-h-0 bg-zinc-950 border border-white/5 rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center group/player">
            <canvas 
              ref={canvasRef} 
              width={CANVAS_WIDTH} 
              height={CANVAS_HEIGHT} 
              className={`h-full w-full object-contain cursor-pointer transition-opacity duration-700 ${scenes.length > 0 ? 'opacity-100' : 'opacity-0'}`}
              onClick={() => {
                if (audioUrl && !isRenderingMP4) {
                  isPlaying ? handlePause() : handlePlay();
                }
              }}
            />

            <AnimatePresence>
              {isRenderingMP4 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none"
                >
                  <div className="w-20 h-20 mb-6 relative">
                    <div className="absolute inset-0 rounded-full border-t-2 border-orange-500 animate-[spin_2s_linear_infinite]" />
                    <div className="absolute inset-2 rounded-full border-r-2 border-white/50 animate-[spin_3s_linear_infinite_reverse]" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Download className="w-6 h-6 text-orange-400 opacity-80" />
                    </div>
                  </div>
                  <h3 className="text-lg font-mono text-white tracking-widest uppercase mb-2">Silent Render Active</h3>
                  <p className="text-orange-400/80 font-mono text-xs max-w-[80%] text-center">
                    Capturing perfect visual frames. Audio remains muted.
                  </p>
                  <p className="mt-8 text-[10px] font-mono text-white/50 px-4 py-1.5 border border-white/10 rounded-full bg-white/5">
                    Please keep this tab open
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {scenes.length === 0 && !isGenerating && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-zinc-950/50">
                <div className="w-20 h-20 bg-orange-500/10 rounded-full flex items-center justify-center mb-6 ring-1 ring-orange-500/20">
                  <Sparkles size={32} className="text-orange-500 animate-pulse" />
                </div>
                <h2 className="text-2xl font-cursive text-white mb-3">Begin Your Story</h2>
                <p className="text-zinc-400 text-sm max-w-[280px] leading-relaxed">
                  Enter an emotional script below to generate an anime-style cinematic video with AI voiceover.
                </p>
                <div className="mt-8 flex gap-2">
                   <div className="px-3 py-1 bg-zinc-900 border border-zinc-800 rounded text-[10px] text-zinc-500">Flux Image Engine</div>
                   <div className="px-3 py-1 bg-zinc-900 border border-zinc-800 rounded text-[10px] text-zinc-500">Gemini TTS</div>
                </div>
              </div>
            )}
            
            {isGenerating && scenes.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950">
                <div className="relative mb-6">
                  <Loader2 size={48} className="text-orange-500 animate-spin" />
                  <div className="absolute inset-0 blur-xl bg-orange-500/20 animate-pulse" />
                </div>
                <h3 className="text-sm font-bold uppercase tracking-widest text-orange-500/80 mb-2">Crafting Vision</h3>
                <div className="w-48 h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
                  <motion.div 
                    className="h-full bg-orange-500" 
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }} 
                  />
                </div>
                <p className="mt-4 text-[10px] font-mono text-zinc-500">{status}</p>
              </div>
            )}

            {!isPlaying && audioUrl && scenes.length > 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none group-hover/player:opacity-0 transition-opacity">
                <div className="w-16 h-16 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-full shadow-2xl flex items-center justify-center transition-all bg-opacity-80 scale-100 hover:scale-110">
                  <Play size={24} fill="currentColor" className="ml-1" />
                </div>
              </div>
            )}

            {/* In-video Regenerate Button */}
            {!isPlaying && scenes.length > 0 && activeSceneIndex >= 0 && (
              <div className="absolute top-4 left-4 z-50">
                <button 
                  disabled={regeneratingIdx === activeSceneIndex}
                  onClick={(e) => { e.stopPropagation(); regenerateImage(activeSceneIndex); }}
                  className="bg-black/60 hover:bg-orange-500 text-white p-2 rounded-full backdrop-blur-md transition-all shadow-xl border border-white/10 group flex items-center gap-2"
                  title="Regenerate this specific frame"
                >
                   <RefreshCw size={16} className={regeneratingIdx === activeSceneIndex ? "animate-spin text-orange-500" : "text-zinc-300 group-hover:text-white"} />
                   <span className="text-xs font-bold shrink-0 hidden group-hover:block pr-1">Regenerate Frame</span>
                </button>
              </div>
            )}

            {/* Over-video controls */}
            {audioUrl && (
              <div className="absolute left-0 right-0 bottom-0 p-3 pt-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex flex-col gap-2 opacity-0 group-hover/player:opacity-100 transition-opacity duration-300">
                <div className="w-full flex flex-col gap-2">
                  <div className="flex items-center justify-between px-1">
                    <button onClick={togglePlay} className="text-white hover:text-orange-500 transition-colors drop-shadow-md">
                      {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
                    </button>
                    <span className="text-[10px] font-mono text-zinc-200 drop-shadow-md">{currentTime.toFixed(1)}s / {duration.toFixed(1)}s</span>
                  </div>
                  
                  <div className="relative w-full h-4 flex items-center group">
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 left-0 h-1.5 bg-orange-500 rounded-full pointer-events-none shadow-[0_0_10px_rgba(249,115,22,0.8)] z-10" 
                      style={{ width: `${(currentTime / (duration || 1)) * 100}%` }} 
                    />
                    <input 
                      type="range" 
                      min={0} 
                      step="any"
                      max={duration || 100} 
                      value={currentTime} 
                      onChange={(e) => {
                        const newTime = parseFloat(e.target.value);
                        if (audioRef.current) {
                          audioRef.current.currentTime = newTime;
                          setCurrentTime(newTime);
                        }
                      }}
                      className="absolute w-full h-1.5 bg-white/20 backdrop-blur-sm rounded-full appearance-none flex cursor-pointer focus:outline-none m-0 hover:[&::-webkit-slider-thumb]:scale-125 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-20 [&::-webkit-slider-thumb]:transition-transform"
                    />
                  </div>
                </div>
              </div>
            )}


        </div>
        
        {/* Settings Overlay Sidebar */}
        <AnimatePresence>
          {showSettings && (
            <>
              {/* Backdrop */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm"
                onClick={() => setShowSettings(false)}
              />
              <motion.div 
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 right-0 bottom-0 w-72 bg-zinc-950 border-l border-zinc-800 shadow-2xl z-[70] flex flex-col"
              >
                <div className="h-14 border-b border-zinc-800/50 px-5 flex items-center justify-between shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Settings</span>
                  <button onClick={() => setShowSettings(false)} className="p-2 -mr-2 text-zinc-500 hover:text-white rounded-lg hover:bg-zinc-900 transition-colors">
                    ✕
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 block">Voice Model</label>
                    <div className="relative group">
                      <select
                        value={selectedVoice}
                        onChange={(e) => setSelectedVoice(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-[12px] outline-none text-zinc-300 appearance-none cursor-pointer focus:border-orange-500/50 transition-all"
                      >
                        {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-600 group-focus-within:text-orange-500 transition-colors">
                        <Volume2 size={14} />
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-[9px] text-zinc-500">
                      <span className="uppercase font-bold tracking-widest">Engine Configuration</span>
                    </div>
                    <div className="bg-zinc-900/50 rounded-xl p-3 text-[11px] font-mono text-zinc-400 space-y-2 border border-zinc-800/50">
                      <div className="flex justify-between p-1 bg-black/20 rounded">
                         <span>TTS Core:</span> <span className="text-orange-500 opacity-80">Flash TTS</span>
                      </div>
                      <div className="flex justify-between p-1 bg-black/20 rounded">
                         <span>Aspect:</span> <span>9:16 (Vertical)</span>
                      </div>
                      <div className="flex justify-between p-1 bg-black/20 rounded">
                         <span>Render:</span> <span>720x1280 px</span>
                      </div>
                      <div className="flex justify-between p-1 bg-black/20 rounded">
                         <span>Format:</span> <span>WebM/VP9+Opus</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom controls container */}
      <div className="shrink-0 flex flex-col w-full relative z-30 bg-zinc-950 border-t border-zinc-800/50">
        
        {/* Larger strip of images preview */}
        {scenes.length > 0 && (
          <div 
            ref={stripRef}
            className="h-40 sm:h-52 w-full overflow-x-auto flex items-center gap-4 px-[50vw] sm:px-[50vw] py-3 scrollbar-hide relative z-20"
          >
            {scenes.map((scene, i) => {
              const isActive = i === activeSceneIndex;
              return (
                <div 
                  key={i} 
                  onClick={() => {
                    if (audioRef.current && duration) {
                      const newTime = Math.min(scene.timestamp, duration - 0.1);
                      audioRef.current.currentTime = newTime;
                      setCurrentTime(newTime);
                    }
                  }}
                  className={`relative group shrink-0 h-full aspect-[9/16] rounded-md overflow-hidden border cursor-pointer transition-all ${
                    isActive 
                    ? 'border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.4)] ring-2 ring-orange-500 z-10 scale-105' 
                    : 'border-zinc-800 opacity-50 hover:opacity-100 hover:border-zinc-600 scale-95'
                  }`}
                >
                  {scene.imageUrl ? (
                    <img src={scene.imageUrl} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                      {regeneratingIdx === i ? <Loader2 size={12} className="animate-spin text-orange-500" /> : <Loader2 size={12} className="animate-spin text-zinc-600" />}
                    </div>
                  )}
                  <div className="absolute top-0 right-0 bg-black/80 px-1 py-0.5 rounded-bl text-[8px] font-mono text-white">
                    {scene.timestamp.toFixed(0)}s
                  </div>
                  {/* Regenerate Button in top left corner */}
                  <div className={`absolute inset-0 bg-transparent pointer-events-none transition-opacity ${isActive ? 'opacity-100 group-hover:opacity-100' : 'opacity-0 hover:opacity-100 hover:backdrop-blur-[1px]'}`}>
                     <button 
                       disabled={regeneratingIdx === i}
                       onClick={(e) => { e.stopPropagation(); regenerateImage(i); }}
                       className={`absolute top-1 left-1 p-1.5 rounded-md transition-all pointer-events-auto backdrop-blur-md z-20 ${isActive ? 'bg-black/60 hover:bg-orange-500' : 'bg-black/40 hover:bg-white/30'}`}
                       title="Regenerate Frame"
                     >
                       <RefreshCw size={12} className={regeneratingIdx === i ? "animate-spin text-orange-500" : ""} />
                     </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom chat input */}
        <div className="relative w-full">
          {/* Toggle arrow & generating indicator */}
          <div className="absolute left-1/2 bottom-full -translate-x-1/2 z-40 flex flex-col items-center">
             {isGenerating && !showInputBar && (
               <div className="mb-2 bg-zinc-900/90 backdrop-blur-md border border-orange-500/30 text-orange-400 px-4 py-1.5 rounded-full text-[10px] font-mono shadow-[0_0_15px_rgba(249,115,22,0.2)] flex items-center gap-2">
                 <Loader2 size={12} className="animate-spin" />
                 <span className="max-w-[150px] sm:max-w-[200px] truncate">{status || 'Generating...'}</span>
                 <span className="font-bold">{progress.toFixed(0)}%</span>
               </div>
             )}
             <button 
               onClick={() => setShowInputBar(!showInputBar)} 
               className="bg-zinc-900 border border-zinc-800/80 text-zinc-400 hover:text-white px-4 py-1 rounded-t-xl hover:bg-zinc-800 transition-colors shadow-[0_-4px_10px_rgba(0,0,0,0.3)] flex items-center justify-center opacity-80 hover:opacity-100"
               title={showInputBar ? "Hide Chat" : "Show Chat"}
             >
               {showInputBar ? <ChevronDown size={14} /> : <ChevronLeft size={14} className="rotate-90" />}
             </button>
          </div>

          <AnimatePresence initial={false}>
            {showInputBar && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden bg-zinc-950 border-t border-zinc-800/50 w-full"
              >
                <div className="p-2 sm:p-3 relative z-30">
                  <div className="max-w-3xl mx-auto flex items-end gap-2 bg-zinc-900 rounded-xl p-1 focus-within:ring-1 focus-within:ring-orange-500/50 transition-all shadow-inner border border-zinc-800">
      {showVoiceSelector && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="p-2 border-b border-zinc-800 bg-zinc-900/50">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-1">Select Voice Model</span>
          </div>
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {VOICES.map(v => (
              <button
                key={v.id}
                onClick={() => {
                  setSelectedVoice(v.id);
                  setShowVoiceSelector(false);
                }}
                className={`w-full text-left px-4 py-3 text-[12px] flex items-center justify-between transition-colors
                  ${selectedVoice === v.id ? 'bg-orange-500/10 text-orange-500' : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'}`}
              >
                <span>{v.name}</span>
                {selectedVoice === v.id && <Zap size={12} fill="currentColor" />}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setShowVoiceSelector(!showVoiceSelector)}
        className="shrink-0 h-[36px] px-3 flex items-center gap-2 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-colors group/voice"
        title="Select Voice Model"
      >
        <Volume2 size={16} className="text-orange-500 group-hover/voice:scale-110 transition-transform" />
        <span className="text-[10px] font-bold uppercase tracking-widest hidden xs:block">{VOICES.find(v => v.id === selectedVoice)?.name.split(' (')[0]}</span>
      </button>
                    <div className="w-px h-6 bg-zinc-800 shrink-0 mb-1.5" />
                    <textarea
                      ref={textareaRef}
                      value={script}
                      onChange={(e) => setScript(e.target.value)}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          generateFullVideo();
                          (e.target as HTMLTextAreaElement).blur();
                        }
                      }}
                      placeholder="Paste script... (Enter to execute)"
                      className="flex-1 bg-transparent border-none text-[13px] text-zinc-200 placeholder:text-zinc-600 outline-none resize-none px-3 py-1.5 min-h-[36px] overflow-y-auto custom-scrollbar leading-relaxed"
                      rows={1}
                    />
                    <button
                      onClick={() => generateFullVideo()}
                      disabled={isGenerating || !script.trim()}
                      className="shrink-0 h-[36px] w-[36px] bg-orange-500 hover:bg-orange-600 text-black rounded-lg flex items-center justify-center shadow-lg shadow-orange-500/20 transition-all disabled:opacity-30 disabled:scale-100 active:scale-95"
                      title="Generate Video"
                    >
                      {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} fill="currentColor" />}
                    </button>
                  </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>

      {error && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm">
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-[11px] backdrop-blur-xl shadow-2xl flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-4 hover:text-white">✕</button>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            >
              <div className="flex justify-between items-center p-4 border-b border-zinc-800">
                <h2 className="font-bold text-lg">Settings & Cloud</h2>
                <button onClick={() => setShowSettings(false)} className="text-zinc-500 hover:text-white p-1">
                  ✕
                </button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[70vh] custom-scrollbar">
                {isAuthLoading ? (
                  <div className="flex justify-center p-10"><Loader2 className="animate-spin text-orange-500" size={32} /></div>
                ) : !user ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-4">
                    <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mb-2">
                       <Zap size={24} className="text-orange-500" />
                    </div>
                    <h3 className="text-xl font-bold">Sync your Workspace</h3>
                    <p className="text-zinc-400 text-center text-sm px-4 max-w-sm mb-4">
                      Connect via a GitHub Personal Access Token (Classic) with <strong>repo</strong> and <strong>gist</strong> scopes to securely store everything entirely in your GitHub account.
                    </p>
                    <form onSubmit={handleLoginWithToken} className="flex flex-col gap-3 w-full max-w-xs">
                      <input 
                        type="password"
                        placeholder="ghp_..."
                        value={githubTokenInput}
                        onChange={(e) => setGithubTokenInput(e.target.value)}
                        className="w-full bg-black border border-zinc-800 rounded-lg p-3 text-sm font-mono text-zinc-300 placeholder:text-zinc-700 outline-none focus:border-orange-500 transition-colors"
                      />
                      <button 
                        type="submit"
                        disabled={!githubTokenInput}
                        className="w-full bg-white text-black font-bold px-6 py-3 rounded-xl shadow-lg hover:scale-[1.02] active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                      >
                        <svg height="20" viewBox="0 0 16 16" version="1.1" width="20" aria-hidden="true" fill="currentColor">
                          <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
                        </svg>
                        Connect via Token
                      </button>
                    </form>
                    <a href="https://github.com/settings/tokens/new?scopes=repo,gist&description=AI%20Studio%20Video%20Editor" target="_blank" rel="noreferrer" className="text-xs text-orange-500 hover:underline">
                      Generate a Token here
                    </a>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between p-3 bg-zinc-950 rounded-xl border border-zinc-800">
                      <div className="flex items-center gap-3">
                        {user.avatar_url ? (
                          <img src={user.avatar_url} alt="Avatar" className="w-8 h-8 rounded-full border border-zinc-700" />
                        ) : (
                          <div className="w-8 h-8 bg-orange-500/20 text-orange-500 rounded-full flex items-center justify-center font-bold">
                            {user.login?.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="text-sm font-bold">{user.name || user.login}</div>
                          <div className="text-xs text-zinc-500">@{user.login}</div>
                        </div>
                      </div>
                      <button onClick={handleLogout} className="text-xs text-zinc-400 hover:text-white bg-zinc-800/50 px-3 py-1.5 rounded-lg">Logout</button>
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-2">API Keys & Workers</h3>
                      
                      <div className="space-y-2">
                        <label className="text-xs text-zinc-500 font-bold uppercase block">Gemini API Keys (comma or line separated)</label>
                        <textarea 
                          value={apiKeysInputText}
                          onChange={(e) => setApiKeysInputText(e.target.value)}
                          className="w-full bg-black border border-zinc-800 rounded-lg p-3 text-sm font-mono text-zinc-300 placeholder:text-zinc-700 outline-none focus:border-orange-500 transition-colors"
                          placeholder="AIzaSy...&#10;AIzaSy..."
                          rows={2}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs text-zinc-500 font-bold uppercase block">Flux Image Worker URLs (comma or line separated)</label>
                        <textarea 
                          value={imageUrlsInputText}
                          onChange={(e) => setImageUrlsInputText(e.target.value)}
                          className="w-full bg-black border border-zinc-800 rounded-lg p-3 text-sm font-mono text-zinc-300 placeholder:text-zinc-700 outline-none focus:border-orange-500 transition-colors"
                          placeholder="https://flux...workers.dev&#10;https://flux..."
                          rows={3}
                        />
                      </div>
                      
                      {saveStatus.message && (
                        <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${saveStatus.type === 'error' ? 'bg-red-500/20 text-red-400' : saveStatus.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400'}`}>
                           {saveStatus.type === 'saving' && <Loader2 size={14} className="animate-spin" />}
                           {saveStatus.message}
                        </div>
                      )}
                      
                      <button 
                        onClick={() => {
                          setSaveStatus({ type: 'saving', message: 'Saving configuration locally...' });
                          try {
                            const newApiKeys = apiKeysInputText.split(/[,\s\n]+/).map(s => s.trim()).filter(Boolean);
                            const newImageUrls = imageUrlsInputText.split(/[,\s\n]+/).map(s => s.trim()).filter(Boolean);
                            
                            setApiKeys(newApiKeys);
                            setImageUrls(newImageUrls);

                            localStorage.setItem('GEMINI_API_KEYS', JSON.stringify(newApiKeys));
                            if (newImageUrls.length > 0) {
                              localStorage.setItem('IMAGE_WORKER_URLS', newImageUrls.join(','));
                            } else {
                              localStorage.removeItem('IMAGE_WORKER_URLS'); 
                            }
                            
                            setSaveStatus({ type: 'success', message: 'Settings saved securely to your browser (Never sent to GitHub!)' });
                            setTimeout(() => setSaveStatus({ type: 'idle', message: '' }), 5000);
                          } catch(e: any) {
                            if (e.name === 'QuotaExceededError' || e.message?.includes('quota')) {
                               setSaveStatus({ type: 'error', message: 'Browser Storage Full. Please use "Clear Local Cache" below.' });
                            } else {
                               setSaveStatus({ type: 'error', message: 'Save Failed: ' + e.message });
                            }
                          }
                        }}
                        disabled={saveStatus.type === 'saving'}
                        className="w-full bg-orange-500 hover:bg-orange-600 text-black font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                         Save Configuration
                      </button>

                      <div className="pt-4 border-t border-zinc-800 flex flex-col gap-2">
                        <button 
                          onClick={() => {
                            if (confirm("This will clear your local GitHub token. You will need to login again. Continue?")) {
                              localStorage.clear();
                              window.location.reload();
                            }
                          }}
                          className="w-full bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-red-400 py-2 rounded-lg text-xs transition-colors"
                        >
                          Clear Local Cache
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      </div>
    </div>
  );
}

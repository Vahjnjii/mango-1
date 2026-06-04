import React, { useEffect, useState } from 'react';

// Re-using the exact frontend loop you liked!
export default function WebCodecsRecorder() {
    const [status, setStatus] = useState("Initializing headless renderer...");
    
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const projectId = urlParams.get('headless-record');
        if (!projectId) return;

        const runRender = async () => {
            try {
                setStatus("Fetching project data...");
                const response = await fetch(`/api/video/status?projectId=${projectId}`);
                if (!response.ok) throw new Error("Failed to fetch project");
                const project = await response.json();

                const { scenes, audioUrl } = project;
                
                const width = 1080;
                const height = 1920;
                const fps = 30;

                setStatus("Processing majestic audio layers...");
                // Download base64 audio and decode
                const audioResp = await fetch(audioUrl);
                const audioBuf = await audioResp.arrayBuffer();
                const tempAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const decodedVoice = await tempAudioCtx.decodeAudioData(audioBuf);
                const duration = decodedVoice.duration;
                const sampleRate = decodedVoice.sampleRate;

                const offlineCtx = new window.OfflineAudioContext(1, Math.ceil(duration * sampleRate), sampleRate);
                const voiceSource = offlineCtx.createBufferSource();
                voiceSource.buffer = decodedVoice;
                voiceSource.connect(offlineCtx.destination);
                voiceSource.start(0);

                const renderedAudio = await offlineCtx.startRendering();
                const pcmData = renderedAudio.getChannelData(0);

                const muxer = new (window as any).Mp4Muxer.Muxer({
                    target: new (window as any).Mp4Muxer.ArrayBufferTarget(),
                    video: { codec: 'avc', width, height },
                    audio: { codec: 'aac', numberOfChannels: 1, sampleRate },
                    fastStart: 'in-memory'
                });

                const videoEncoder = new window.VideoEncoder({
                    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
                    error: (e: any) => console.error('VideoEncoder error', e)
                });
                videoEncoder.configure({ codec: 'avc1.42002A', width, height, bitrate: 5000000, framerate: fps });

                const audioEncoder = new window.AudioEncoder({
                    output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
                    error: (e: any) => console.error('AudioEncoder error', e)
                });
                audioEncoder.configure({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: 1, bitrate: 128000 });

                setStatus("Caching visual assets...");
                const loadedImages: Record<string, HTMLImageElement> = {};
                for (const sc of scenes) {
                    if (sc.imageUrl && !loadedImages[sc.imageUrl]) {
                        const img = new Image();
                        img.crossOrigin = "anonymous";
                        img.src = sc.imageUrl;
                        await new Promise<void>(resolve => {
                            img.onload = () => resolve();
                            img.onerror = () => resolve();
                        });
                        loadedImages[sc.imageUrl] = img;
                    }
                }

                setStatus("Forging cinematic frames at hyper-speed...");
                const offscreenCanvas = document.createElement("canvas");
                offscreenCanvas.width = width;
                offscreenCanvas.height = height;
                const ctx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
                if (!ctx) throw new Error("No 2d context for offline canvas");

                const totalFrames = Math.ceil(duration * fps);
                
                type CinematicParticle = { x: number, y: number, vx: number, vy: number, size: number, type: string, life: number, maxLife: number, opacity: number, color?: string, rotation?: number, vr?: number };
                const offlineParticles: CinematicParticle[] = [];
                for (let i = 0; i < 60; i++) {
                    offlineParticles.push({
                        x: Math.random() * width, y: Math.random() * height * 1.5,
                        vx: (Math.random() - 0.5) * 1.0, vy: -1 - Math.random() * 2,
                        size: Math.random() * 80 + 20, life: Math.random() * 800, maxLife: 800 + Math.random() * 400, opacity: 0, type: 'shadow'
                    });
                    offlineParticles.push({
                        x: Math.random() * width, y: Math.random() * height,
                        vx: (Math.random() - 0.5) * 2.5, vy: -2 - Math.random() * 4,
                        size: Math.random() * 3 + 1, life: Math.random() * 200, maxLife: 150 + Math.random() * 100, opacity: 0, type: 'ember',
                        color: ['#ff4500', '#ff8c00', '#ffd700'][Math.floor(Math.random() * 3)]
                    });
                }

                for (let fIdx = 0; fIdx < totalFrames; fIdx++) {
                    const timeOffset = fIdx / fps;
                    const timeMs = timeOffset * 1000;
                    
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(0, 0, width, height);

                    let sceneIndex = 0;
                    for (let i = scenes.length - 1; i >= 0; i--) {
                        if (scenes[i].timestamp <= timeOffset) {
                            sceneIndex = i;
                            break;
                        }
                    }
                    const currentScene = scenes[sceneIndex];
                    
                    if (currentScene && currentScene.imageUrl && loadedImages[currentScene.imageUrl]) {
                        const sceneStart = currentScene.timestamp;
                        const nextScene = scenes[sceneIndex + 1];
                        const sceneEnd = nextScene ? nextScene.timestamp : duration;
                        const sceneDuration = Math.max(0.1, sceneEnd - sceneStart);
                        const progressInScene = Math.max(0, Math.min(1, (timeOffset - sceneStart) / sceneDuration));
                        
                        const img = loadedImages[currentScene.imageUrl];
                        const shakeX = Math.sin(timeMs / 150) * 1.5;
                        const shakeY = Math.cos(timeMs / 180) * 1.5;
                        const isZoomIn = sceneIndex % 2 === 0;
                        const zoomAmount = 0.10;
                        const zoomScale = isZoomIn ? (1.0 + progressInScene * zoomAmount) : (1.0 + zoomAmount - progressInScene * zoomAmount);

                        ctx.save();
                        ctx.globalAlpha = 1.0; 
                        ctx.translate(width / 2 + shakeX, height / 2 + shakeY);
                        ctx.scale(zoomScale, zoomScale);
                        
                        const imgAspect = img.naturalWidth / img.naturalHeight;
                        const canvasAspect = width / height;
                        let drawW, drawH;
                        if (imgAspect > canvasAspect) {
                            drawH = height;
                            drawW = height * imgAspect;
                        } else {
                            drawW = width;
                            drawH = width / imgAspect;
                        }
                        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
                        ctx.restore();

                        const gradient = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, height/1.1);
                        gradient.addColorStop(0, 'transparent');
                        gradient.addColorStop(0.7, 'rgba(0,0,0,0.2)');
                        gradient.addColorStop(1, 'rgba(0,0,0,0.8)');
                        ctx.fillStyle = gradient;
                        ctx.fillRect(0, 0, width, height);
                        
                        ctx.save();
                        ctx.globalAlpha = 0.12; 
                        for(let i=0; i<3500; i++) {
                            const gx = Math.random() * width;
                            const gy = Math.random() * height;
                            const intensity = Math.random() * 255;
                            ctx.fillStyle = `rgb(${intensity}, ${intensity}, ${intensity})`;
                            ctx.fillRect(gx, gy, 1.2, 1.2);
                        }
                        ctx.restore();
                    }

                    // Particles
                    ctx.save();
                    offlineParticles.forEach(p => {
                        const swayFreq = p.type === 'smoke' ? (2000 + (p.x % 1000)) : 1000;
                        const swayAmp = p.type === 'smoke' ? 0.8 : 0.4;
                        p.x += p.vx + Math.sin(timeMs / swayFreq + (p.life * 0.02)) * swayAmp;
                        p.y += p.vy;
                        p.life++;
                        
                        if (p.life < p.maxLife * 0.15) p.opacity = p.life / (p.maxLife * 0.15);
                        else if (p.life > p.maxLife * 0.7) p.opacity = 1 - (p.life - p.maxLife * 0.7) / (p.maxLife * 0.3);
                        else p.opacity = 1;
                        
                        const verticalFade = Math.max(0, Math.min(1, (p.y + p.size) / (height * 0.9)));
                        if (p.opacity > 0) {
                            if (p.type === 'shadow') {
                                ctx.fillStyle = `rgba(0, 0, 0, ${p.opacity * 0.4})`;
                                ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
                            } else if (p.type === 'ember') {
                                ctx.save();
                                ctx.globalCompositeOperation = 'lighter';
                                ctx.shadowBlur = 12; ctx.shadowColor = p.color || '#ff9d00';
                                ctx.fillStyle = p.color || '#ff9d00';
                                ctx.globalAlpha = p.opacity * Math.random() * 0.9 * verticalFade; 
                                ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
                                ctx.restore();
                            }
                        }
                        if (p.life >= p.maxLife || p.y < -500 || p.x < -300 || p.x > width + 300) {
                            p.x = Math.random() * width; p.y = height + 100 + Math.random() * 400; p.life = 0; p.opacity = 0;
                        }
                    });
                    ctx.restore();

                    // Subtitles
                    if (currentScene?.text) {
                        ctx.save();
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.font = 'bold 84px "Dancing Script", cursive';
                        
                        const fullText = currentScene.text.trim();
                        const words = fullText.split(/\s+/);
                        const WORDS_PER_CHUNK = 4; 
                        const chunks: string[] = [];
                        for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) chunks.push(words.slice(i, i + WORDS_PER_CHUNK).join(' '));
                        
                        const sceneStart = currentScene.timestamp;
                        const sceneDuration = Math.max(0.1, (scenes[sceneIndex + 1]?.timestamp || duration) - sceneStart);
                        const progressInScene = Math.max(0, Math.min(1, (timeOffset - sceneStart) / sceneDuration));
                        const currentWordIdx = Math.floor(progressInScene * words.length);
                        const chunkIndex = Math.min(Math.floor(currentWordIdx / WORDS_PER_CHUNK), chunks.length - 1);
                        let chunkText = (chunks[chunkIndex] || "").trim();

                        if (chunkText.length > 0 && /^[a-z]/.test(chunkText)) chunkText = chunkText.charAt(0).toUpperCase() + chunkText.slice(1);

                        const txtx = width / 2;
                        const txty = height * 0.75; 
                        const chunkWords = chunkText.split(' ');
                        const displayLines: string[] = [];
                        if (chunkWords.length >= 4) { displayLines.push(chunkWords.slice(0, 2).join(' ')); displayLines.push(chunkWords.slice(2).join(' ')); } 
                        else { displayLines.push(chunkText); }
                        
                        displayLines.forEach((line, index) => {
                            const lineY = txty + (index - (displayLines.length - 1) / 2) * 110;
                            ctx.save();
                            ctx.shadowColor = 'rgba(0, 0, 0, 1)'; ctx.shadowBlur = 35; ctx.lineWidth = 14; ctx.strokeStyle = '#000000';
                            ctx.strokeText(line, txtx, lineY);
                            ctx.restore();
                            const textGrad = ctx.createLinearGradient(txtx, lineY - 40, txtx, lineY + 40);
                            textGrad.addColorStop(0, '#FFFFFF'); textGrad.addColorStop(1, '#ffc400');
                            ctx.fillStyle = textGrad; ctx.fillText(line, txtx, lineY);
                        });
                        ctx.restore();
                    }
                    
                    const videoFrame = new window.VideoFrame(offscreenCanvas, { timestamp: timeOffset * 1e6 });
                    videoEncoder.encode(videoFrame);
                    videoFrame.close();
                    
                    // Allow UI to update
                    if (fIdx % 20 === 0) {
                        setStatus(`Rendering exactly like frontend: ${Math.floor((fIdx / totalFrames) * 100)}%`);
                        await new Promise(r => setTimeout(r, 0));
                    }
                }

                setStatus("Multiplexing master tracks...");
                const samplesPerFrame = sampleRate * 0.1;
                let offset = 0;
                while (offset < pcmData.length) {
                    const end = Math.min(offset + samplesPerFrame, pcmData.length);
                    const sub = pcmData.subarray(offset, end);
                    const audioData = new window.AudioData({
                        format: 'f32-planar', sampleRate, numberOfFrames: sub.length, numberOfChannels: 1, timestamp: (offset / sampleRate) * 1e6, data: sub
                    });
                    audioEncoder.encode(audioData);
                    audioData.close();
                    offset += sub.length;
                }

                await videoEncoder.flush();
                await audioEncoder.flush();
                muxer.finalize();
                
                const buffer = muxer.target.buffer;
                const blob = new Blob([buffer], { type: 'video/mp4' });

                // POST back to server
                setStatus("Uploading master sequence to server...");
                const formData = new FormData();
                formData.append('projectId', projectId);
                formData.append('video', blob, `project_${projectId}_output.mp4`);

                await fetch('/api/video/upload-render', {
                    method: 'POST',
                    body: formData
                });

                setStatus("Finished!");
                setTimeout(() => {
                    if ((window as any).onRenderComplete) (window as any).onRenderComplete();
                }, 100);

            } catch (err: any) {
                setStatus("Error: " + err.message);
                if ((window as any).onRenderError) (window as any).onRenderError(err.message);
            }
        };

        runRender();
    }, []);

    return (
        <div style={{ background: '#000', color: '#fff', padding: '20px', fontFamily: 'monospace' }}>
            <h2>Backend Headless Renderer is Running</h2>
            <p>{status}</p>
        </div>
    );
}

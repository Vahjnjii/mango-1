import React, { useEffect, useState } from 'react';
import { initParticles, renderFrame } from './renderHelper';


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
                
                const offlineParticles = initParticles();

                for (let fIdx = 0; fIdx < totalFrames; fIdx++) {
                    const timeOffset = fIdx / fps;
                    const timeMs = timeOffset * 1000;
                    
                    renderFrame(
                      ctx,
                      width,
                      height,
                      timeMs,
                      timeOffset,
                      duration,
                      scenes,
                      loadedImages,
                      null,
                      offlineParticles,
                      true, // isPlaying
                      false // isGenerating
                    );
                    
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

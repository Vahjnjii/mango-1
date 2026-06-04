import fs from 'fs';
let code = fs.readFileSync('src/WebCodecsRecorder.tsx', 'utf-8');

const importStr = `import React, { useEffect, useState } from 'react';\nimport { initParticles, renderFrame } from './renderHelper';\n`;
code = code.replace(`import React, { useEffect, useState } from 'react';`, importStr);

const startStr = `                const totalFrames = Math.ceil(duration * fps);`;
const endStr = `                setStatus("Multiplexing master tracks...");`;

const replacement = `                const totalFrames = Math.ceil(duration * fps);
                
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
                        setStatus(\`Rendering exactly like frontend: \${Math.floor((fIdx / totalFrames) * 100)}%\`);
                        await new Promise(r => setTimeout(r, 0));
                    }
                }

`;

const startIndex = code.indexOf(startStr);
const endIndex = code.indexOf(endStr);

if (startIndex === -1 || endIndex === -1) {
  console.log("Not found!");
  console.log("start:", startIndex, "end:", endIndex);
} else {
  const newCode = code.slice(0, startIndex) + replacement + code.slice(endIndex);
  fs.writeFileSync('src/WebCodecsRecorder.tsx', newCode);
  console.log("Success!");
}

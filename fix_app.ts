import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const startStr = `    // Ensure particles are initialized\n    if (particlesRef.current.length === 0) initParticles();`;

const endStr = `      requestRef.current = requestAnimationFrame(render);\n    };\n    requestRef.current = requestAnimationFrame(render);\n    return () => cancelAnimationFrame(requestRef.current);\n  }, [scenes, currentTime, isGenerating]);`;

const replacement = `    // Ensure particles are initialized
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
  }, [scenes, currentTime, isGenerating]);`;

const startIndex = code.indexOf(startStr);
const endIndex = code.indexOf(endStr);

if (startIndex === -1 || endIndex === -1) {
  console.log("Not found!");
  console.log("start:", startIndex, "end:", endIndex);
} else {
  const newCode = code.slice(0, startIndex) + replacement + code.slice(endIndex + endStr.length);
  fs.writeFileSync('src/App.tsx', newCode);
  console.log("Success!");
}

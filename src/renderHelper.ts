export type CinematicParticle = { 
  x: number; 
  y: number; 
  vx: number; 
  vy: number; 
  size: number; 
  life: number; 
  maxLife: number; 
  opacity: number; 
  type: 'shadow' | 'ember' | 'smoke'; 
  color?: string; 
  rotation?: number; 
  vr?: number; 
};

export const initParticles = (): CinematicParticle[] => {
  const particles: CinematicParticle[] = [];
  
  // Shadow Particles
  for (let i = 0; i < 20; i++) {
    particles.push({
      x: Math.random() * 1080,
      y: Math.random() * 1920,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      size: 1 + Math.random() * 3,
      life: Math.random() * 100,
      maxLife: 200 + Math.random() * 200,
      opacity: 0,
      type: 'shadow'
    });
  }

  // Fire Embers (Increased count and brightness)
  for (let i = 0; i < 45; i++) {
    particles.push({
      x: Math.random() * 1080,
      y: 1920 + Math.random() * 200,
      vx: (Math.random() - 0.5) * 3.0, 
      vy: -3.0 - Math.random() * 5.0, 
      size: 0.4 + Math.random() * 1.2, 
      life: 0,
      maxLife: 250 + Math.random() * 400,
      opacity: 0,
      type: 'ember',
      color: Math.random() > 0.4 ? '#ffcc00' : (Math.random() > 0.5 ? '#ff6600' : '#ffffff')
    });
  }

  // Smoke Wisps (Reduced count for less clutter)
  for (let i = 0; i < 22; i++) {
    particles.push({
      x: Math.random() * 1080,
      y: 1920 + Math.random() * 500,
      vx: (Math.random() - 0.5) * 0.8,
      vy: -1.0 - Math.random() * 1.8, 
      size: 50 + Math.random() * 120, 
      life: 0,
      maxLife: 600 + Math.random() * 1000,
      opacity: 0,
      type: 'smoke',
      rotation: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.008 
    });
  }

  return particles;
};

export const renderFrame = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  timeMs: number,
  audioTime: number,
  duration: number,
  scenes: any[],
  loadedImages: { [url: string]: HTMLImageElement } | null,
  imageElementRef: { current: HTMLImageElement | null } | null,
  particlesList: CinematicParticle[],
  isPlaying: boolean,
  isGenerating: boolean
) => {
  if (!ctx || scenes.length === 0) return;
  
  const SCENE_DURATION = 5;
  const localTime = audioTime % SCENE_DURATION;
  
  // Find the correct scene for the current time
  let sceneIndex = 0;
  for (let i = scenes.length - 1; i >= 0; i--) {
    if (scenes[i].timestamp <= audioTime) {
      sceneIndex = i;
      break;
    }
  }
  const currentScene = scenes[sceneIndex];
  if (!currentScene) return;

  const sceneStart = currentScene.timestamp;
  const nextScene = scenes[sceneIndex + 1];
  const sceneEnd = nextScene ? nextScene.timestamp : duration;
  const sceneDuration = Math.max(0.1, sceneEnd - sceneStart);
  const progressInScene = Math.max(0, Math.min(1, (audioTime - sceneStart) / sceneDuration));

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  if (currentScene?.imageUrl) {
    let img: HTMLImageElement | null = null;
    if (loadedImages && loadedImages[currentScene.imageUrl]) {
      img = loadedImages[currentScene.imageUrl];
    } else if (imageElementRef && imageElementRef.current) {
      if (imageElementRef.current.src !== currentScene.imageUrl) {
        imageElementRef.current.src = currentScene.imageUrl;
      }
      img = imageElementRef.current;
    }

    if (img && img.complete && img.naturalWidth !== 0) {
      const shakeX = Math.sin(timeMs / 150) * 1.5;
      const shakeY = Math.cos(timeMs / 180) * 1.5;
      
      // Alternating 10% Zoom Effect (Ken Burns)
      const isZoomIn = sceneIndex % 2 === 0;
      const zoomAmount = 0.10;
      const zoomScale = isZoomIn 
        ? (1.0 + progressInScene * zoomAmount) 
        : (1.0 + zoomAmount - progressInScene * zoomAmount);

      ctx.save();
      ctx.globalAlpha = 1.0; 
      
      ctx.translate(canvasWidth / 2 + shakeX, canvasHeight / 2 + shakeY);
      ctx.scale(zoomScale, zoomScale);
      const imgAspect = img.naturalWidth / img.naturalHeight;
      const canvasAspect = canvasWidth / canvasHeight;
      let drawW, drawH;
      if (imgAspect > canvasAspect) {
        drawH = canvasHeight;
        drawW = canvasHeight * imgAspect;
      } else {
        drawW = canvasWidth;
        drawH = canvasWidth / imgAspect;
      }
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
      const gradient = ctx.createRadialGradient(canvasWidth/2, canvasHeight/2, 0, canvasWidth/2, canvasHeight/2, canvasHeight/1.1);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(0.7, 'rgba(0,0,0,0.2)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.8)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      
      // Persistent Cinematic Noise Grain
      ctx.save();
      ctx.globalAlpha = 0.12; 
      for(let i=0; i<3500; i++) {
        const gx = Math.random() * canvasWidth;
        const gy = Math.random() * canvasHeight;
        const intensity = Math.random() * 255;
        ctx.fillStyle = `rgb(${intensity}, ${intensity}, ${intensity})`;
        ctx.fillRect(gx, gy, 1.2, 1.2);
      }
      ctx.restore();
    }
  } 

  // Cinematic Particles Overlay (Shadows, Embers, Smoke)
  ctx.save();
  particlesList.forEach(p => {
    // Advanced Physics: Add slight turbulence/air current
    if (p.type === 'smoke' || p.type === 'ember') {
      // Add random jitter to velocity - scaled down for smoothness
      p.vx += (Math.random() - 0.5) * 0.15; 
      p.vy += (Math.random() - 0.5) * 0.05; 
      
      // Air resistance / capping
      p.vx *= 0.98;
      
      if (p.rotation !== undefined && p.vr !== undefined) {
         p.rotation += p.vr;
      }
    }

    // Use more varied frequency for sway to avoid "circular" look
    const swayFreq = p.type === 'smoke' ? (2000 + (p.x % 1000)) : 1000;
    const swayAmp = p.type === 'smoke' ? 0.8 : 0.4;
    p.x += p.vx + Math.sin(timeMs / swayFreq + (p.life * 0.02)) * swayAmp;
    p.y += p.vy;
    p.life++;

    // Smoke expands as it rises
    if (p.type === 'smoke') {
      p.size += 0.25; // Continuous expansion
    }

    // Opacity mapping for smooth fade in/out
    if (p.life < p.maxLife * 0.15) {
      p.opacity = p.life / (p.maxLife * 0.15);
    } else if (p.life > p.maxLife * 0.7) {
      p.opacity = 1 - (p.life - p.maxLife * 0.7) / (p.maxLife * 0.3);
    } else {
      p.opacity = 1;
    }

    // Realistic vertical fade: disappears as it moves to the top
    const verticalFade = Math.max(0, Math.min(1, (p.y + p.size) / (canvasHeight * 0.9)));

    // Render based on type
    if (p.opacity > 0) {
      if (p.type === 'shadow') {
        ctx.fillStyle = `rgba(0, 0, 0, ${p.opacity * 0.4})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'ember') {
        const flicker = 0.7 + Math.random() * 0.3;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter'; // Makes embers pop
        ctx.shadowBlur = 12; 
        ctx.shadowColor = p.color || '#ff9d00';
        ctx.fillStyle = p.color || '#ff9d00';
        ctx.globalAlpha = p.opacity * flicker * 0.9 * verticalFade; 
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (p.type === 'smoke') {
        ctx.save();
        ctx.translate(p.x, p.y);
        if (p.rotation) ctx.rotate(p.rotation);
        
        // Very low base opacity for smoke to allow stacking
        const smokeOpacity = p.opacity * 0.035 * verticalFade;
        
        // Single, ultra-soft radial gradient for a "mist" look
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
        grad.addColorStop(0, `rgba(220, 220, 220, ${smokeOpacity})`);
        grad.addColorStop(0.3, `rgba(200, 200, 200, ${smokeOpacity * 0.6})`);
        grad.addColorStop(0.6, `rgba(180, 180, 180, ${smokeOpacity * 0.2})`);
        grad.addColorStop(1, 'rgba(150, 150, 150, 0)');
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        // Stretched ellipse for more organic shape
        ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Recycle particles with randomized restart
    if (p.life >= p.maxLife || p.y < -500 || p.x < -300 || p.x > canvasWidth + 300) {
      p.x = Math.random() * canvasWidth;
      p.y = canvasHeight + 100 + Math.random() * 400;
      p.life = 0;
      p.opacity = 0;
      p.vx = (Math.random() - 0.5) * (p.type === 'ember' ? 2.5 : 1.0);
      if (p.type === 'smoke') p.size = 80 + Math.random() * 200;
    }
  });
  ctx.restore();

  // Subtle Glitch Effect
  const glitchSeed = Math.random();
  if (glitchSeed < 0.05 && audioTime > 0 && isPlaying) {
    ctx.save();
    const sliceY = Math.random() * canvasHeight;
    const sliceH = 5 + Math.random() * 40;
    const sliceX = (Math.random() - 0.5) * 10;
    
    // Note: To glitch we can draw a slice of the canvas itself back onto it
    if ((ctx as any).canvas) {
      const sourceCanvas = (ctx as any).canvas;
      ctx.drawImage(sourceCanvas, 0, sliceY, canvasWidth, sliceH, sliceX, sliceY, canvasWidth, sliceH);
    }
    
    // Occasional color aberration
    if (glitchSeed < 0.02) {
      ctx.globalAlpha = 0.2;
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, sliceY, canvasWidth, 2);
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(0, sliceY + 4, canvasWidth, 2);
    }
    ctx.restore();
  }

  // Subtitles - Centered Single Line with Character Chunking
  if (currentScene?.text) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const fullText = currentScene.text.trim();
    const words = fullText.split(/\s+/);
    const WORDS_PER_CHUNK = 4; // 3-4 words per chunk
    
    // Chunking by words
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
      chunks.push(words.slice(i, i + WORDS_PER_CHUNK).join(' '));
    }
    
    // Calculate which chunk to show based on word count progress for better word-to-voice matching
    const currentWordIdx = Math.floor(progressInScene * words.length);
    const chunkIndex = Math.min(Math.floor(currentWordIdx / WORDS_PER_CHUNK), chunks.length - 1);
    let chunkText = (chunks[chunkIndex] || "").trim();

    // Preserve original capitalization and punctuation from the AI-generated text, 
    // just ensure it doesn't look like a mid-sentence fragment if possible.
    if (chunkText.length > 0 && /^[a-z]/.test(chunkText)) {
      chunkText = chunkText.charAt(0).toUpperCase() + chunkText.slice(1);
    }

    ctx.font = 'bold 84px "Dancing Script", cursive';
    
    const x = canvasWidth / 2;
    const y = canvasHeight * 0.75; 
    const lineHeight = 110; 

    // Split words to handle line-breaking for chunks of 4 words
    const chunkWords = chunkText.split(' ');
    const displayLines: string[] = [];
    
    if (chunkWords.length >= 4) {
      // Exactly 4 words or more: split into two lines for readability
      displayLines.push(chunkWords.slice(0, 2).join(' '));
      displayLines.push(chunkWords.slice(2).join(' '));
    } else {
      displayLines.push(chunkText);
    }
    
    displayLines.forEach((line, index) => {
      // Calculate individual line Y to keep the block centered around 'y'
      const lineY = y + (index - (displayLines.length - 1) / 2) * lineHeight;

      // Intense Dark Glow Outline
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 1)';
      ctx.shadowBlur = 35;
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(line, x, lineY);
      ctx.restore();

      // Subtitle Text (Strong Yellow/Orange gradient for luxury feel)
      const textGrad = ctx.createLinearGradient(x, lineY - 40, x, lineY + 40);
      textGrad.addColorStop(0, '#FFFFFF');
      textGrad.addColorStop(1, '#ffc400');
      ctx.fillStyle = textGrad;
      ctx.fillText(line, x, lineY);
    });

    ctx.restore();
  }

  if (isGenerating) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0,0, canvasWidth, canvasHeight);
    ctx.fillStyle = '#f97316';
    ctx.textAlign = 'center';
    ctx.font = 'bold 48px Inter';
    ctx.fillText('Generating Next Set...', canvasWidth / 2, canvasHeight / 2);
  }
};

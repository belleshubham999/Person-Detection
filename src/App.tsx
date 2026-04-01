import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Cpu, Activity, Shield, Maximize2, Settings, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Prediction {
  bbox: [number, number, number, number];
  class: string;
  score: number;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  
  const [isReady, setIsReady] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [fps, setFps] = useState(0);
  const [latency, setLatency] = useState(0);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const lastFrameTime = useRef<number>(0);
  const processingFrame = useRef<boolean>(false);

  // Initialize Worker
  useEffect(() => {
    // Create worker from the worker file
    // In Vite, we use ?worker suffix or new URL
    workerRef.current = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module'
    });

    workerRef.current.onmessage = (e) => {
      if (e.data.type === 'READY') {
        setIsReady(true);
      } else if (e.data.type === 'RESULTS') {
        const now = performance.now();
        setPredictions(e.data.predictions);
        setLatency(Math.round(now - e.data.timestamp));
        processingFrame.current = false;
      }
    };

    workerRef.current.postMessage({ type: 'INIT' });

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // Start Camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment',
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      setError("Camera access denied or not available.");
      console.error(err);
    }
  };

  // Processing Loop
  const processFrame = useCallback(async () => {
    if (!videoRef.current || !isReady || !isCameraActive || processingFrame.current) return;

    const video = videoRef.current;
    if (video.readyState < 2) return; // HAVE_CURRENT_DATA

    processingFrame.current = true;
    
    // Calculate FPS
    const now = performance.now();
    if (lastFrameTime.current > 0) {
      const delta = now - lastFrameTime.current;
      setFps(Math.round(1000 / delta));
    }
    lastFrameTime.current = now;

    // Capture frame as ImageBitmap for efficient transfer to worker
    try {
      const imageBitmap = await createImageBitmap(video);
      workerRef.current?.postMessage({
        type: 'PROCESS',
        imageBitmap,
        width: video.videoWidth,
        height: video.videoHeight,
        timestamp: now
      }, [imageBitmap]); // Transfer ownership
    } catch (err) {
      console.error("Frame capture error:", err);
      processingFrame.current = false;
    }
  }, [isReady, isCameraActive]);

  useEffect(() => {
    let animationId: number;
    const loop = () => {
      processFrame();
      animationId = requestAnimationFrame(loop);
    };
    if (isCameraActive && isReady) {
      animationId = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(animationId);
  }, [isCameraActive, isReady, processFrame]);

  // Draw Overlays
  useEffect(() => {
    if (!canvasRef.current || !videoRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const video = videoRef.current;
    canvasRef.current.width = video.videoWidth;
    canvasRef.current.height = video.videoHeight;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    predictions.forEach(prediction => {
      const [x, y, width, height] = prediction.bbox;
      
      // Draw Box
      ctx.strokeStyle = '#00ff41';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);
      
      // Draw Label Background
      ctx.fillStyle = 'rgba(0, 255, 65, 0.8)';
      const label = `${prediction.class} (${Math.round(prediction.score * 100)}%)`;
      const textWidth = ctx.measureText(label).width;
      ctx.fillRect(x, y - 20, textWidth + 10, 20);
      
      // Draw Label Text
      ctx.fillStyle = '#000000';
      ctx.font = '12px "JetBrains Mono"';
      ctx.fillText(label, x + 5, y - 5);

      // Draw Corners for "Technical" look
      ctx.beginPath();
      ctx.moveTo(x, y + 20); ctx.lineTo(x, y); ctx.lineTo(x + 20, y);
      ctx.moveTo(x + width - 20, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + 20);
      ctx.moveTo(x + width, y + height - 20); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width - 20, y + height);
      ctx.moveTo(x + 20, y + height); ctx.lineTo(x, y + height); ctx.lineTo(x, y + height - 20);
      ctx.stroke();
    });
  }, [predictions]);

  return (
    <div className="min-h-screen flex flex-col data-grid overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-[var(--line)] flex items-center justify-between px-6 bg-[var(--bg)] z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[var(--accent)] rounded flex items-center justify-center">
            <Cpu className="text-black w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-widest uppercase glitch-text">VisionFlow v1.0</h1>
            <p className="text-[10px] opacity-50 uppercase">CPU-Only Neural Pipeline</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] opacity-50 uppercase">Inference Engine</span>
            <span className="text-xs text-[var(--accent)] font-bold">TFJS-CPU / COCO-SSD</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] opacity-50 uppercase">Status</span>
            <span className={`text-xs font-bold ${isReady ? 'text-[var(--accent)]' : 'text-yellow-500'}`}>
              {isReady ? 'SYSTEM_READY' : 'LOADING_MODEL...'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative flex items-center justify-center p-4">
        <div className="relative w-full max-w-4xl aspect-video bg-black border border-[var(--line)] shadow-2xl overflow-hidden group">
          <div className="scanner-line"></div>
          
          {/* Video Stream */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
          
          {/* Canvas Overlay */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full object-cover z-10"
          />

          {/* UI Overlays */}
          <AnimatePresence>
            {!isCameraActive && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
              >
                <Camera className="w-16 h-16 text-[var(--accent)] mb-4 opacity-20" />
                <h2 className="text-xl font-bold mb-6 tracking-tighter">INITIALIZE OPTICAL SENSORS</h2>
                <button
                  onClick={startCamera}
                  disabled={!isReady}
                  className={`px-8 py-3 border-2 border-[var(--accent)] text-[var(--accent)] font-bold uppercase tracking-widest hover:bg-[var(--accent)] hover:text-black transition-all disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  {isReady ? 'Start Stream' : 'Calibrating...'}
                </button>
                {error && <p className="mt-4 text-red-500 text-xs font-mono">{error}</p>}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Corner Decorations */}
          <div className="absolute top-4 left-4 z-20 flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[var(--accent)] text-[10px]">
              <Activity className="w-3 h-3" />
              <span>LIVE_FEED_ACTIVE</span>
            </div>
            <div className="text-[10px] opacity-50">RES: 640x480</div>
          </div>

          <div className="absolute top-4 right-4 z-20 text-right">
            <div className="text-[var(--accent)] text-xl font-bold leading-none">{fps}</div>
            <div className="text-[10px] opacity-50 uppercase">FPS</div>
          </div>

          <div className="absolute bottom-4 left-4 z-20">
            <div className="text-[var(--accent)] text-xl font-bold leading-none">{latency}ms</div>
            <div className="text-[10px] opacity-50 uppercase">Latency</div>
          </div>

          <div className="absolute bottom-4 right-4 z-20 flex gap-2">
            <div className="w-8 h-8 border border-[var(--line)] flex items-center justify-center text-white/20 hover:text-[var(--accent)] cursor-pointer">
              <Maximize2 className="w-4 h-4" />
            </div>
            <div className="w-8 h-8 border border-[var(--line)] flex items-center justify-center text-white/20 hover:text-[var(--accent)] cursor-pointer">
              <Settings className="w-4 h-4" />
            </div>
          </div>
        </div>
      </main>

      {/* Sidebar / Info Panel */}
      <footer className="h-24 border-t border-[var(--line)] bg-[var(--bg)] flex items-center px-6 gap-8 overflow-x-auto">
        <div className="min-w-[200px] border-r border-[var(--line)] pr-8">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-3 h-3 text-[var(--accent)]" />
            <span className="text-[10px] font-bold uppercase">Security Protocol</span>
          </div>
          <p className="text-[10px] opacity-50 leading-tight">
            Neural network isolation active. All processing occurs on local CPU threads. No GPU acceleration detected.
          </p>
        </div>

        <div className="flex-1 flex gap-4">
          {predictions.length > 0 ? (
            predictions.map((p, i) => (
              <div key={i} className="px-3 py-2 border border-[var(--accent)]/30 bg-[var(--accent)]/5 rounded flex flex-col">
                <span className="text-[9px] uppercase opacity-50">Detected</span>
                <span className="text-xs font-bold text-[var(--accent)]">{p.class}</span>
                <span className="text-[9px] opacity-50">{Math.round(p.score * 100)}% Match</span>
              </div>
            ))
          ) : (
            <div className="flex items-center gap-3 opacity-20 italic text-xs">
              <Info className="w-4 h-4" />
              <span>Scanning for objects...</span>
            </div>
          )}
        </div>

        <div className="min-w-[150px] text-right">
          <div className="text-[10px] opacity-50 uppercase mb-1">Thread Load</div>
          <div className="w-full h-1 bg-[var(--line)] rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-[var(--accent)]"
              animate={{ width: isCameraActive ? '85%' : '10%' }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
      </footer>
    </div>
  );
}

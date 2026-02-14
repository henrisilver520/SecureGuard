import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import * as fb from '@/services/firebase';
import { MotionEngine, type MotionZone } from '@/engine/motionEngine';

type SourceEl = HTMLVideoElement | HTMLImageElement;

type ZoneType = 'door' | 'drawer' | 'window' | 'safe' | 'desk' | 'custom';

const ZONE_META: Record<ZoneType, { label: string; icon: string; color: string }> = {
  door: { label: 'Porta', icon: '🚪', color: '#ef4444' },
  drawer: { label: 'Gaveta', icon: '🗄️', color: '#f97316' },
  window: { label: 'Janela', icon: '🪟', color: '#3b82f6' },
  safe: { label: 'Cofre', icon: '🔒', color: '#a855f7' },
  desk: { label: 'Mesa', icon: '🖥️', color: '#06b6d4' },
  custom: { label: 'Custom', icon: '📍', color: '#22c55e' },
};

let audioCtx: AudioContext | null = null;
function playAlert(type: 'warning' | 'critical' | 'info') {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'critical') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.setValueAtTime(660, audioCtx.currentTime + 0.15);
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
    } else if (type === 'warning') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.2);
    }
  } catch {
    // silent
  }
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

interface CameraCardProps {
  config: fb.CameraConfig;
  persons: fb.PersonRecord[];
  onConfigChange: (cameraId: string, updates: Partial<fb.CameraConfig>) => void;
  onRemove: (cameraId: string) => void;
}

export function CameraCard({ config, persons, onConfigChange, onRemove }: CameraCardProps) {
  const { id: cameraId, name, source, settings } = config;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef(new MotionEngine());
  const rafRef = useRef<number>(0);
  const faceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAlertRef = useRef(0);
  const detectingRef = useRef(false);

  const [isStreaming, setIsStreaming] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [intensity, setIntensity] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Zones
  const [zones, setZones] = useState<MotionZone[]>(() => config.zones as any);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [drawingType, setDrawingType] = useState<ZoneType | null>(null);
  const drawStart = useRef<{ x: number; y: number } | null>(null);

  // Face
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [faceActive, setFaceActive] = useState(false);

  // Sync zones into config (local + firebase) - debounced
  useEffect(() => {
    const t = setTimeout(() => {
      onConfigChange(cameraId, { zones: zones as any });
      fb.updateCameraFor(cameraId, { zonesCount: zones.length, name, location: config.location ?? 'Local não definido' });
    }, 500);
    return () => clearTimeout(t);
  }, [cameraId, zones, onConfigChange, name, config.location]);

  // Sync settings into firebase camera record
  useEffect(() => {
    fb.updateCameraFor(cameraId, { name, location: config.location ?? 'Local não definido' });
  }, [cameraId, name, config.location]);

  const sourceEl = useMemo<SourceEl | null>(() => {
    return source.type === 'webcam' || source.mode === 'video' ? videoRef.current : imgRef.current;
  }, [source.type, (source as any).mode, isStreaming]);

  const stopAll = useCallback(() => {
    detectingRef.current = false;
    setIsDetecting(false);
    setFaceActive(false);
    setIntensity(0);
    engineRef.current.reset();

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;

    if (faceTimerRef.current) {
      clearInterval(faceTimerRef.current);
      faceTimerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      (videoRef.current as any).srcObject = null;
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }

    setIsStreaming(false);
    fb.updateCameraFor(cameraId, { status: 'offline', personsDetected: 0 });
  }, [cameraId]);

  useEffect(() => {
    // Cleanup on unmount
    return () => stopAll();
  }, [stopAll]);

  const startStream = useCallback(async () => {
    setError(null);
    try {
      if (source.type === 'webcam') {
        if (!audioCtx) audioCtx = new AudioContext();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: source.deviceId ? { exact: source.deviceId } : undefined,
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'environment',
          },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          (videoRef.current as any).srcObject = stream;
          await videoRef.current.play();
        }
      } else {
        // IP camera
        if (source.mode === 'mjpeg') {
          if (imgRef.current) {
            imgRef.current.src = source.url;
          }
        } else {
          if (videoRef.current) {
            videoRef.current.src = source.url;
            videoRef.current.crossOrigin = 'anonymous';
            videoRef.current.muted = true;
            await videoRef.current.play();
          }
        }
      }

      setIsStreaming(true);
      fb.updateCameraFor(cameraId, { status: 'online', name, location: config.location ?? 'Local não definido' });
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'Falha ao iniciar stream'}`);
      fb.updateCameraFor(cameraId, { status: 'offline' });
    }
  }, [cameraId, source, name, config.location]);

  const motionLoop = useCallback(() => {
    if (!detectingRef.current) return;
    const el = (source.type === 'webcam' || source.mode === 'video') ? videoRef.current : imgRef.current;
    if (!el) {
      rafRef.current = requestAnimationFrame(motionLoop);
      return;
    }

    const result = engineRef.current.analyze(el as any, zones as any, settings.sensitivity);
    setIntensity(result.intensity);

    const now = Date.now();
    const hasZoneAlert = result.alertedZones.length > 0;
    const hasMotion = result.intensity > 15;
    const shouldAlert = settings.zonesOnly ? hasZoneAlert : (hasZoneAlert || hasMotion);

    if (settings.motionEnabled && shouldAlert && (now - lastAlertRef.current) > (settings.cooldownSec * 1000)) {
      lastAlertRef.current = now;

      const snapshot = engineRef.current.captureSnapshot(el as any, result.alertedZones);
      const severity: fb.EventSeverity = result.alertedZones.some(z => z.zone.alertLevel === 'critical')
        ? 'critical'
        : result.alertedZones.some(z => z.zone.alertLevel === 'high')
          ? 'high'
          : result.intensity > 50 ? 'medium' : 'low';

      const evt: fb.SecurityEvent = {
        id: fb.generateId('evt'),
        type: hasZoneAlert ? 'zone_breach' : 'motion',
        severity,
        cameraId,
        cameraName: name,
        message: hasZoneAlert
          ? `Movimento em ${result.alertedZones.map(z => z.zone.label).join(', ')}`
          : `Movimento detectado (${result.intensity}%)`,
        personId: null,
        personName: null,
        personPermission: null,
        zoneName: result.alertedZones[0]?.zone.label ?? null,
        zoneType: result.alertedZones[0]?.zone.type ?? null,
        thumbnail: snapshot,
        motionIntensity: result.intensity,
        timestamp: new Date().toISOString(),
        acknowledged: false,
        acknowledgedBy: null,
        acknowledgedAt: null,
      };

      fb.saveEvent(evt);
      fb.updateDailyStats(evt);

      if (settings.soundOn) {
        playAlert(severity === 'critical' ? 'critical' : 'warning');
      }
    }

    // ~12 FPS cap to keep CPU sane.
    setTimeout(() => {
      rafRef.current = requestAnimationFrame(motionLoop);
    }, 80);
  }, [zones, settings, cameraId, name, source.type, (source as any).mode]);

  const toggleDetection = useCallback(() => {
    if (!isStreaming) return;

    if (detectingRef.current) {
      detectingRef.current = false;
      setIsDetecting(false);
      engineRef.current.reset();
      setIntensity(0);
      fb.updateCameraFor(cameraId, { status: 'online' });
    } else {
      detectingRef.current = true;
      setIsDetecting(true);
      engineRef.current.reset();
      rafRef.current = requestAnimationFrame(motionLoop);
      fb.updateCameraFor(cameraId, { status: 'detecting' });
    }
  }, [isStreaming, motionLoop, cameraId]);

  const loadFaceModels = useCallback(async () => {
    if (modelsLoaded || modelsLoading) return;
    setModelsLoading(true);
    try {
      const faceapi = await import('face-api.js');
      const url = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model';
      await faceapi.nets.tinyFaceDetector.loadFromUri(url);
      await faceapi.nets.faceLandmark68Net.loadFromUri(url);
      await faceapi.nets.faceRecognitionNet.loadFromUri(url);
      setModelsLoaded(true);
    } catch {
      setError('Falha ao carregar modelos faciais');
    } finally {
      setModelsLoading(false);
    }
  }, [modelsLoaded, modelsLoading]);

  const cropFace = useCallback((el: SourceEl, box: { x: number; y: number; width: number; height: number }) => {
    const c = document.createElement('canvas');
    c.width = 150;
    c.height = 150;
    const ctx = c.getContext('2d')!;
    const pad = Math.max(box.width, box.height) * 0.3;
    ctx.drawImage(el as any,
      Math.max(0, box.x - pad),
      Math.max(0, box.y - pad),
      box.width + pad * 2,
      box.height + pad * 2,
      0, 0, 150, 150
    );
    return c.toDataURL('image/jpeg', 0.7);
  }, []);

  const personsRef = useRef<fb.PersonRecord[]>(persons);
  useEffect(() => { personsRef.current = persons; }, [persons]);

  const recentFaceIds = useRef(new Map<string, number>());

  const runFaceDetection = useCallback(async () => {
    if (!settings.faceEnabled) return;

    const el = (source.type === 'webcam' || source.mode === 'video') ? videoRef.current : imgRef.current;
    if (!el) return;

    const faceapi = await import('face-api.js');
    try {
      const detections = await faceapi
        .detectAllFaces(el as any, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      const now = Date.now();
      let personsDetected = 0;

      for (const det of detections) {
        personsDetected++;
        const box = det.detection.box;
        const desc = Array.from(det.descriptor);
        const thumb = cropFace(el, box);
        const match = fb.findBestMatch(desc, personsRef.current, 0.55);

        const faceKey = match?.person.id ?? `unk_${Math.round(box.x / 50)}_${Math.round(box.y / 50)}`;
        const lastSeen = recentFaceIds.current.get(faceKey);
        const isNew = !lastSeen || (now - lastSeen) > 5000;
        if (isNew) recentFaceIds.current.set(faceKey, now);

        if (!isNew) continue;

        const perm = match?.person.permission ?? 'unknown';
        const evtType: fb.EventType = match
          ? (perm === 'unauthorized' ? 'face_blocked' : 'face_known')
          : 'face_unknown';
        const severity: fb.EventSeverity = perm === 'unauthorized'
          ? 'critical'
          : perm === 'unknown' ? 'high' : 'low';

        const evt: fb.SecurityEvent = {
          id: fb.generateId('evt'),
          type: evtType,
          severity,
          cameraId,
          cameraName: name,
          message: match
            ? (perm === 'unauthorized'
              ? `⚠ PESSOA BLOQUEADA: ${match.person.name}`
              : `${match.person.name} identificado(a)`)
            : 'Rosto desconhecido detectado',
          personId: match?.person.id ?? null,
          personName: match?.person.name ?? null,
          personPermission: perm,
          zoneName: null,
          zoneType: null,
          thumbnail: thumb,
          motionIntensity: 0,
          timestamp: new Date().toISOString(),
          acknowledged: false,
          acknowledgedBy: null,
          acknowledgedAt: null,
        };

        fb.saveEvent(evt);
        fb.updateDailyStats(evt);

        if (match?.person.id) {
          fb.updatePerson(match.person.id, {
            lastSeenAt: new Date().toISOString(),
            totalSightings: (match.person.totalSightings || 0) + 1,
          });
        }

        if (settings.soundOn) {
          if (perm === 'unauthorized') playAlert('critical');
          else if (perm === 'unknown') playAlert('warning');
          else playAlert('info');
        }
      }

      for (const [k, t] of recentFaceIds.current) {
        if (now - t > 30000) recentFaceIds.current.delete(k);
      }

      fb.updateCameraFor(cameraId, { personsDetected });
    } catch {
      // keep silent
    }
  }, [cameraId, cropFace, name, settings.faceEnabled, settings.soundOn, source.type, (source as any).mode]);

  const toggleFace = useCallback(async () => {
    if (!isStreaming) return;

    if (!modelsLoaded) {
      await loadFaceModels();
    }

    if (faceActive) {
      if (faceTimerRef.current) clearInterval(faceTimerRef.current);
      faceTimerRef.current = null;
      setFaceActive(false);
      return;
    }

    setFaceActive(true);
    // ~1.25 FPS to limit CPU
    faceTimerRef.current = setInterval(runFaceDetection, 800);
  }, [faceActive, isStreaming, loadFaceModels, modelsLoaded, runFaceDetection]);

  const saveSettings = (patch: Partial<fb.CameraSettings>) => {
    onConfigChange(cameraId, { settings: { ...settings, ...patch } as any });
  };

  // ----- Zone drawing -----
  const onOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawingType) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    drawStart.current = { x, y };
    setSelectedZoneId(null);
  };

  const onOverlayMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawingType || !drawStart.current) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x2 = (e.clientX - rect.left) / rect.width;
    const y2 = (e.clientY - rect.top) / rect.height;
    const x1 = drawStart.current.x;
    const y1 = drawStart.current.y;

    const x = Math.max(0, Math.min(x1, x2));
    const y = Math.max(0, Math.min(y1, y2));
    const width = Math.min(1 - x, Math.abs(x2 - x1));
    const height = Math.min(1 - y, Math.abs(y2 - y1));

    const id = '__draft__';
    const meta = ZONE_META[drawingType];
    setZones(prev => {
      const clean = prev.filter(z => z.id !== id);
      return [...clean, {
        id,
        label: meta.label,
        type: drawingType,
        color: meta.color,
        x,
        y,
        width,
        height,
        sensitivity: 50,
        active: true,
        alertLevel: 'medium',
      }];
    });
  };

  const onOverlayMouseUp = () => {
    if (!drawingType) return;
    setZones(prev => {
      const draft = prev.find(z => z.id === '__draft__');
      const clean = prev.filter(z => z.id !== '__draft__');
      if (!draft) return clean;
      if (draft.width < 0.04 || draft.height < 0.04) return clean;

      return [...clean, { ...draft, id: makeId('zone') }];
    });
    drawStart.current = null;
    setDrawingType(null);
  };

  const removeZone = (zoneId: string) => {
    setZones(prev => prev.filter(z => z.id !== zoneId));
    if (selectedZoneId === zoneId) setSelectedZoneId(null);
  };

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/70 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-100 truncate">{name}</p>
          <p className="text-[10px] text-slate-500 truncate">
            {source.type === 'webcam' ? 'Webcam local' : `IP: ${source.url}`}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <span className={cn('text-[10px] px-2 py-0.5 rounded-full border',
            isDetecting ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' :
              isStreaming ? 'border-blue-500/40 text-blue-300 bg-blue-500/10' :
                'border-slate-700 text-slate-400 bg-slate-800/40'
          )}>
            {isDetecting ? 'Detectando' : isStreaming ? 'Online' : 'Offline'}
          </span>
          <button
            onClick={() => onRemove(cameraId)}
            className="text-slate-500 hover:text-red-300 text-xs px-2"
            title="Remover"
          >
            🗑️
          </button>
        </div>
      </div>

      <div className="relative aspect-video bg-black">
        {(source.type === 'webcam' || source.mode === 'video') ? (
          <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
        ) : (
          <img ref={imgRef} className="absolute inset-0 h-full w-full object-cover" alt={name} />
        )}

        {/* Zones overlay */}
        <div
          className={cn(
            'absolute inset-0',
            drawingType ? 'cursor-crosshair' : 'cursor-default'
          )}
          onMouseDown={onOverlayMouseDown}
          onMouseMove={onOverlayMouseMove}
          onMouseUp={onOverlayMouseUp}
        >
          {zones.map(z => (
            <div
              key={z.id}
              className={cn(
                'absolute border-2 rounded-sm',
                selectedZoneId === z.id ? 'ring-2 ring-white/70' : 'ring-0'
              )}
              style={{
                left: `${z.x * 100}%`,
                top: `${z.y * 100}%`,
                width: `${z.width * 100}%`,
                height: `${z.height * 100}%`,
                borderColor: z.color,
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                if (z.id === '__draft__') return;
                setSelectedZoneId(z.id);
              }}
            >
              <div className="absolute -top-5 left-0 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-white">
                <span>{(ZONE_META[z.type as ZoneType] ?? ZONE_META.custom).icon}</span>
                <span className="max-w-[140px] truncate">{z.label}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="absolute left-2 bottom-2 flex items-center gap-2">
          <span className={cn('text-[10px] px-2 py-1 rounded-full border',
            intensity > 45 ? 'border-red-500/40 bg-red-500/15 text-red-200' :
              intensity > 15 ? 'border-amber-500/40 bg-amber-500/15 text-amber-200' :
                'border-slate-700 bg-slate-900/70 text-slate-300'
          )}>
            Movimento: {intensity}%
          </span>
          {error && (
            <span className="text-[10px] px-2 py-1 rounded-full border border-red-500/40 bg-red-500/15 text-red-200">
              {error}
            </span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="p-3 space-y-2">
        <div className="flex gap-2">
          {!isStreaming ? (
            <button
              onClick={startStream}
              className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 py-2 text-xs font-semibold text-white"
            >
              ▶ Iniciar
            </button>
          ) : (
            <button
              onClick={stopAll}
              className="flex-1 rounded-lg bg-slate-800 hover:bg-slate-700 py-2 text-xs font-semibold text-slate-200"
            >
              ⏹ Parar
            </button>
          )}

          <button
            onClick={toggleDetection}
            disabled={!isStreaming}
            className={cn(
              'flex-1 rounded-lg py-2 text-xs font-semibold',
              !isStreaming ? 'bg-emerald-600/20 text-emerald-200 cursor-not-allowed'
                : isDetecting ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200'
            )}
          >
            {isDetecting ? '🟢 Detectando' : '🟡 Detecção'}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={toggleFace}
            disabled={!isStreaming || !settings.faceEnabled}
            className={cn(
              'rounded-lg border px-2 py-2 text-[11px] font-semibold',
              !settings.faceEnabled ? 'border-slate-800 bg-slate-950 text-slate-600 cursor-not-allowed'
                : faceActive ? 'border-violet-500/50 bg-violet-500/15 text-violet-200'
                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
            )}
          >
            {modelsLoading ? '⏳' : '🙂'} Face
          </button>

          <button
            onClick={() => saveSettings({ soundOn: !settings.soundOn })}
            className={cn(
              'rounded-lg border px-2 py-2 text-[11px] font-semibold',
              settings.soundOn ? 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
                : 'border-slate-800 bg-slate-950 text-slate-600'
            )}
          >
            {settings.soundOn ? '🔊 Som' : '🔇 Som'}
          </button>

          <button
            onClick={() => saveSettings({ zonesOnly: !settings.zonesOnly })}
            className={cn(
              'rounded-lg border px-2 py-2 text-[11px] font-semibold',
              settings.zonesOnly ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
            )}
          >
            🧱 Zonas
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Sensibilidade</span>
              <span className="text-[10px] text-slate-300 font-semibold">{settings.sensitivity}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.sensitivity}
              onChange={e => saveSettings({ sensitivity: Number(e.target.value) })}
              className="w-full"
            />
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Cooldown</span>
              <span className="text-[10px] text-slate-300 font-semibold">{settings.cooldownSec}s</span>
            </div>
            <input
              type="range"
              min={1}
              max={20}
              value={settings.cooldownSec}
              onChange={e => saveSettings({ cooldownSec: Number(e.target.value) })}
              className="w-full"
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Detecção facial</span>
            <label className="text-[10px] text-slate-300 flex items-center gap-1">
              <input
                type="checkbox"
                checked={settings.faceEnabled}
                onChange={e => saveSettings({ faceEnabled: e.target.checked })}
              />
              Ativar
            </label>
          </div>
          <p className="mt-1 text-[10px] text-slate-600">
            Facial consome CPU. Ative apenas em câmeras críticas.
          </p>
        </div>

        {/* Zone tools */}
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-slate-500">Zonas ({zones.filter(z => z.id !== '__draft__').length})</span>
            {selectedZoneId && (
              <button
                onClick={() => removeZone(selectedZoneId)}
                className="text-[10px] font-semibold text-red-300 hover:text-red-200"
              >
                Remover selecionada
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(ZONE_META) as ZoneType[]).map(t => (
              <button
                key={t}
                onClick={() => setDrawingType(t)}
                className={cn(
                  'rounded-md border px-2 py-1 text-[10px] font-semibold',
                  drawingType === t
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                )}
                title="Clique e arraste no vídeo"
              >
                {ZONE_META[t].icon} {ZONE_META[t].label}
              </button>
            ))}
          </div>

          <p className="mt-2 text-[10px] text-slate-600">
            Para criar: selecione um tipo e arraste sobre o vídeo.
          </p>
        </div>
      </div>
    </div>
  );
}

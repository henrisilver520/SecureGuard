import { useMemo, useState } from 'react';
import { cn } from '@/utils/cn';
import type { CameraConfig, CameraSource } from '@/services/firebase';

interface AddCameraModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (config: Omit<CameraConfig, 'createdAt' | 'updatedAt'>) => void;
}

const DEFAULT_SETTINGS: CameraConfig['settings'] = {
  motionEnabled: true,
  faceEnabled: false,
  sensitivity: 50,
  zonesOnly: false,
  cooldownSec: 3,
  soundOn: true,
};

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

export function AddCameraModal({ open, onClose, onAdd }: AddCameraModalProps) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [sourceType, setSourceType] = useState<CameraSource['type']>('webcam');
  const [ipUrl, setIpUrl] = useState('');
  const [ipMode, setIpMode] = useState<'mjpeg' | 'video'>('mjpeg');

  const canSubmit = useMemo(() => {
    if (!name.trim()) return false;
    if (sourceType === 'ip') return /^https?:\/\//i.test(ipUrl.trim());
    return true;
  }, [name, sourceType, ipUrl]);

  if (!open) return null;

  const submit = () => {
    if (!canSubmit) return;

    const id = makeId('cam');
    const source: CameraSource = sourceType === 'webcam'
      ? { type: 'webcam' }
      : { type: 'ip', url: ipUrl.trim(), mode: ipMode };

    onAdd({
      id,
      name: name.trim(),
      location: location.trim() || undefined,
      source,
      settings: { ...DEFAULT_SETTINGS },
      zones: [],
    });

    setName('');
    setLocation('');
    setIpUrl('');
    setSourceType('webcam');
    setIpMode('mjpeg');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-xl"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-100">Adicionar câmera</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-slate-400">Nome</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
              placeholder="Ex: Entrada principal"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400">Local (opcional)</label>
            <input
              value={location}
              onChange={e => setLocation(e.target.value)}
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
              placeholder="Ex: Portaria"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400">Fonte</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                onClick={() => setSourceType('webcam')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs font-semibold',
                  sourceType === 'webcam'
                    ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                    : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
                )}
              >
                🎥 Webcam
              </button>
              <button
                onClick={() => setSourceType('ip')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs font-semibold',
                  sourceType === 'ip'
                    ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                    : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
                )}
              >
                🌐 IP (HTTP)
              </button>
            </div>
            <p className="mt-1 text-[10px] text-slate-500">
              Nota: RTSP não roda direto no navegador. Para RTSP use um gateway (WebRTC/HLS/MJPEG).
            </p>
          </div>

          {sourceType === 'ip' && (
            <div className="space-y-2">
              <div>
                <label className="text-[11px] text-slate-400">URL do stream</label>
                <input
                  value={ipUrl}
                  onChange={e => setIpUrl(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                  placeholder="https://.../mjpeg ou .mp4/.webm"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400">Modo</label>
                <select
                  value={ipMode}
                  onChange={e => setIpMode(e.target.value as any)}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
                >
                  <option value="mjpeg">MJPEG (recomendado)</option>
                  <option value="video">Video (se o navegador suportar)</option>
                </select>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 py-2 text-xs font-semibold text-slate-300 hover:border-slate-600"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className={cn(
                'flex-1 rounded-lg py-2 text-xs font-semibold',
                canSubmit
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-blue-600/20 text-blue-300 cursor-not-allowed'
              )}
            >
              Adicionar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import * as fb from '@/services/firebase';
import { cn } from '@/utils/cn';
import { CameraGrid, type GridLayout } from '@/components/CameraGrid';
import { CameraCard } from '@/components/CameraCard';
import { AddCameraModal } from '@/components/AddCameraModal';

type Tab = 'live' | 'events' | 'persons' | 'stats';

const LS_CAMERAS_KEY = 'sg_cameras_v2';

function nowIso() {
  return new Date().toISOString();
}

function defaultWebcamConfig(): fb.CameraConfig {
  const id = fb.getCameraId();
  return {
    id,
    name: 'Webcam Principal',
    location: 'Local não definido',
    source: { type: 'webcam' },
    settings: {
      motionEnabled: true,
      faceEnabled: false,
      sensitivity: 50,
      zonesOnly: false,
      cooldownSec: 3,
      soundOn: true,
    },
    zones: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function loadLocalCameras(): fb.CameraConfig[] {
  try {
    const raw = localStorage.getItem(LS_CAMERAS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalCameras(cameras: fb.CameraConfig[]) {
  try {
    localStorage.setItem(LS_CAMERAS_KEY, JSON.stringify(cameras));
  } catch {
    // ignore
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('live');
  const [layout, setLayout] = useState<GridLayout>(4);
  const [addOpen, setAddOpen] = useState(false);

  // Firebase data
  const [persons, setPersons] = useState<fb.PersonRecord[]>([]);
  const [events, setEvents] = useState<fb.SecurityEvent[]>([]);
  const [todayStats, setTodayStats] = useState<fb.DailyStats | null>(null);
  const [weekStats, setWeekStats] = useState<fb.DailyStats[]>([]);

  // Cameras (persisted locally + synced to Firestore)
  const [cameras, setCameras] = useState<fb.CameraConfig[]>(() => {
    const local = loadLocalCameras();
    if (local.length > 0) return local;
    const base = [defaultWebcamConfig()];
    saveLocalCameras(base);
    return base;
  });

  // ---- Firebase subscriptions ----
  useEffect(() => {
    const unsub1 = fb.subscribePersons(setPersons);
    const unsub2 = fb.subscribeEvents(300, setEvents);
    fb.getTodayStats().then(s => s && setTodayStats(s));
    fb.getStatsRange(7).then(setWeekStats);
    return () => { unsub1(); unsub2(); };
  }, []);

  // ---- One-time sync of local camera configs to Firestore ----
  useEffect(() => {
    (async () => {
      for (const c of cameras) {
        const remote = await fb.getCameraConfig(c.id);
        if (!remote) {
          await fb.saveCameraConfig({ ...c, updatedAt: nowIso() });
        } else {
          // Prefer local name/location/source/settings, but keep remote timestamps.
          await fb.updateCameraConfig(c.id, {
            name: c.name,
            location: c.location,
            source: c.source,
            settings: c.settings,
            zones: c.zones,
          });
        }
        await fb.updateCameraFor(c.id, {
          name: c.name,
          location: c.location ?? 'Local não definido',
          status: 'offline',
          zonesCount: c.zones.length,
          personsDetected: 0,
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Local persistence ----
  useEffect(() => {
    saveLocalCameras(cameras);
  }, [cameras]);

  const onAddCamera = async (c: Omit<fb.CameraConfig, 'createdAt' | 'updatedAt'>) => {
    const cfg: fb.CameraConfig = { ...c, createdAt: nowIso(), updatedAt: nowIso() };
    setCameras(prev => [...prev, cfg]);
    await fb.saveCameraConfig(cfg);
    await fb.updateCameraFor(cfg.id, {
      name: cfg.name,
      location: cfg.location ?? 'Local não definido',
      status: 'offline',
      zonesCount: cfg.zones.length,
      personsDetected: 0,
    });
  };

  const onConfigChange = async (cameraId: string, updates: Partial<fb.CameraConfig>) => {
    setCameras(prev => prev.map(c => c.id === cameraId ? ({ ...c, ...updates, updatedAt: nowIso() } as fb.CameraConfig) : c));
    await fb.updateCameraConfig(cameraId, updates);
  };

  const onRemoveCamera = async (cameraId: string) => {
    setCameras(prev => prev.filter(c => c.id !== cameraId));
    await fb.updateCameraFor(cameraId, { status: 'offline', personsDetected: 0 });
  };

  const filteredEvents = useMemo(() => {
    return events;
  }, [events]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold">SecureGuard — Multi-Câmeras</h1>
            <p className="text-[10px] text-slate-500">Monitoramento paralelo de múltiplas fontes (Webcam + IP HTTP)</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-slate-900/70 border border-slate-800 rounded-lg p-0.5">
              {(
                [
                  { id: 'live', label: 'Ao vivo', icon: '📹' },
                  { id: 'events', label: 'Eventos', icon: '🧾' },
                  { id: 'persons', label: 'Pessoas', icon: '👥' },
                  { id: 'stats', label: 'Stats', icon: '📈' },
                ] as const
              ).map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1',
                    tab === t.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                  )}
                >
                  <span>{t.icon}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="mx-auto max-w-7xl px-4 py-4">
        {tab === 'live' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Layout:</span>
                {[1, 4, 9].map(n => (
                  <button
                    key={n}
                    onClick={() => setLayout(n as GridLayout)}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-xs font-semibold',
                      layout === n
                        ? 'border-blue-500/50 bg-blue-500/15 text-blue-200'
                        : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                    )}
                  >
                    {n === 1 ? '1x1' : n === 4 ? '2x2' : '3x3'}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAddOpen(true)}
                  className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-2 text-xs font-semibold"
                >
                  ➕ Adicionar câmera
                </button>
              </div>
            </div>

            <CameraGrid layout={layout}>
              {cameras.map(c => (
                <CameraCard
                  key={c.id}
                  config={c}
                  persons={persons}
                  onConfigChange={onConfigChange}
                  onRemove={onRemoveCamera}
                />
              ))}
            </CameraGrid>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-200">Eventos recentes (agregado)</h3>
                <span className="text-[10px] text-slate-500">Mostrando {Math.min(8, events.length)} de {events.length}</span>
              </div>
              <div className="mt-2 space-y-2">
                {events.slice(0, 8).map(e => (
                  <div key={e.id} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-2">
                    <span className="text-xs">{e.type === 'motion' ? '🏃' : e.type.startsWith('face') ? '🙂' : '🧱'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-slate-200 truncate">
                        <span className="text-slate-400">[{e.cameraName}]</span> {e.message}
                      </p>
                      <p className="text-[10px] text-slate-600 truncate">{new Date(e.timestamp).toLocaleString('pt-BR')}</p>
                    </div>
                    <span className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full border',
                      e.severity === 'critical' && 'border-red-500/40 bg-red-500/15 text-red-200',
                      e.severity === 'high' && 'border-orange-500/40 bg-orange-500/15 text-orange-200',
                      e.severity === 'medium' && 'border-amber-500/40 bg-amber-500/15 text-amber-200',
                      e.severity === 'low' && 'border-slate-700 bg-slate-900/50 text-slate-300'
                    )}>
                      {e.severity}
                    </span>
                  </div>
                ))}
                {events.length === 0 && (
                  <div className="text-xs text-slate-500 py-6 text-center">Nenhum evento ainda.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'events' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
            <h3 className="text-xs font-semibold text-slate-200">Eventos</h3>
            <div className="mt-2 space-y-2">
              {filteredEvents.map(e => (
                <div key={e.id} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <img
                    src={e.thumbnail || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='}
                    alt=""
                    className="w-16 h-12 rounded-lg object-cover border border-slate-800"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-slate-200">
                      <span className="text-slate-400">[{e.cameraName}]</span> {e.message}
                    </p>
                    <p className="text-[10px] text-slate-600">{new Date(e.timestamp).toLocaleString('pt-BR')}</p>
                    {e.personName && (
                      <p className="text-[10px] text-slate-400">Pessoa: {e.personName} ({e.personPermission})</p>
                    )}
                  </div>
                  <span className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full border',
                    e.severity === 'critical' && 'border-red-500/40 bg-red-500/15 text-red-200',
                    e.severity === 'high' && 'border-orange-500/40 bg-orange-500/15 text-orange-200',
                    e.severity === 'medium' && 'border-amber-500/40 bg-amber-500/15 text-amber-200',
                    e.severity === 'low' && 'border-slate-700 bg-slate-900/50 text-slate-300'
                  )}>
                    {e.type}
                  </span>
                </div>
              ))}
              {filteredEvents.length === 0 && (
                <div className="text-xs text-slate-500 py-6 text-center">Nenhum evento.</div>
              )}
            </div>
          </div>
        )}

        {tab === 'persons' && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
            <h3 className="text-xs font-semibold text-slate-200">Pessoas cadastradas</h3>
            <p className="text-[10px] text-slate-500 mt-1">
              Cadastro e treino continuam via Firestore (coleção <span className="font-mono">persons</span>). Aqui é um painel simples.
            </p>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {persons.map(p => (
                <div key={p.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 flex gap-3">
                  <img src={p.thumbnail} alt={p.name} className="w-14 h-14 rounded-xl object-cover border border-slate-800" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-100 truncate">{p.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{p.role || '—'}</p>
                    <p className="text-[10px] text-slate-400 mt-1">Permissão: <span className="font-semibold">{p.permission}</span></p>
                    <p className="text-[10px] text-slate-600">Avistamentos: {p.totalSightings || 0}</p>
                  </div>
                </div>
              ))}
              {persons.length === 0 && (
                <div className="text-xs text-slate-500 py-6 text-center col-span-full">Nenhuma pessoa cadastrada.</div>
              )}
            </div>
          </div>
        )}

        {tab === 'stats' && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
              <h3 className="text-xs font-semibold text-slate-200">Hoje</h3>
              {todayStats ? (
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { label: 'Eventos', value: todayStats.totalEvents, icon: '🧾' },
                    { label: 'Movimento', value: todayStats.totalMotion, icon: '🏃' },
                    { label: 'Faces', value: todayStats.totalFaces, icon: '🙂' },
                    { label: 'Bloqueios', value: todayStats.blockedAttempts, icon: '🚫' },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                      <p className="text-[10px] text-slate-500">{s.icon} {s.label}</p>
                      <p className="text-xl font-bold text-slate-100 font-mono">{s.value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">Sem dados hoje.</p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
              <h3 className="text-xs font-semibold text-slate-200">Últimos 7 dias</h3>
              <div className="mt-2 space-y-2">
                {weekStats.map(d => (
                  <div key={d.date} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 p-2">
                    <span className="text-[11px] text-slate-300">{new Date(d.date).toLocaleDateString('pt-BR')}</span>
                    <div className="flex items-center gap-3 text-[10px] text-slate-400">
                      <span>🧾 {d.totalEvents}</span>
                      <span>🏃 {d.totalMotion}</span>
                      <span>🙂 {d.totalFaces}</span>
                      <span>🚫 {d.blockedAttempts}</span>
                    </div>
                  </div>
                ))}
                {weekStats.length === 0 && (
                  <p className="text-xs text-slate-500">Sem dados de histórico.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <AddCameraModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={onAddCamera} />
    </div>
  );
}

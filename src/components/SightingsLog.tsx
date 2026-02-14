/**
 * SightingsLog — Histórico de rostos avistados pela câmera.
 * 
 * Mostra:
 * - Foto do rosto
 * - Se é autorizado, não autorizado ou desconhecido
 * - Confiança do match
 * - Timestamp
 */

import { cn } from '@/utils/cn';
import type { FaceSighting } from '@/engine/faceDatabase';

interface SightingsLogProps {
  sightings: FaceSighting[];
  onClear: () => void;
}

const PERMISSION_CONFIG = {
  authorized: { label: 'Autorizado', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', icon: '✅' },
  unauthorized: { label: 'NÃO AUTORIZADO', bg: 'bg-red-500/15', border: 'border-red-500/40', text: 'text-red-400', icon: '🚫' },
  unknown: { label: 'Desconhecido', bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', icon: '❓' },
};

export function SightingsLog({ sightings, onClear }: SightingsLogProps) {
  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // formatDate is used inside the grouped rendering below

  // Group sightings by date
  const grouped = sightings.reduce<Record<string, FaceSighting[]>>((acc, s) => {
    const dateKey = new Date(s.timestamp).toLocaleDateString('pt-BR');
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(s);
    return acc;
  }, {});

  // Stats
  const totalUnauthorized = sightings.filter(s => s.permission === 'unauthorized').length;
  const totalUnknown = sightings.filter(s => s.permission === 'unknown').length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">📋</span>
          <h3 className="text-sm font-semibold text-slate-200">Avistamentos</h3>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
            {sightings.length}
          </span>
        </div>
        {sightings.length > 0 && (
          <button onClick={onClear} className="text-xs text-slate-500 hover:text-slate-300">
            Limpar
          </button>
        )}
      </div>

      {/* Quick stats */}
      {sightings.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <div className="bg-slate-800/50 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-blue-400 font-mono">{sightings.length}</p>
            <p className="text-[9px] text-slate-500">Total</p>
          </div>
          <div className={cn('rounded-lg p-2 text-center', totalUnauthorized > 0 ? 'bg-red-500/10' : 'bg-slate-800/50')}>
            <p className={cn('text-lg font-bold font-mono', totalUnauthorized > 0 ? 'text-red-400' : 'text-slate-600')}>{totalUnauthorized}</p>
            <p className="text-[9px] text-slate-500">Não Autorizados</p>
          </div>
          <div className={cn('rounded-lg p-2 text-center', totalUnknown > 0 ? 'bg-amber-500/10' : 'bg-slate-800/50')}>
            <p className={cn('text-lg font-bold font-mono', totalUnknown > 0 ? 'text-amber-400' : 'text-slate-600')}>{totalUnknown}</p>
            <p className="text-[9px] text-slate-500">Desconhecidos</p>
          </div>
        </div>
      )}

      {/* Sightings list */}
      <div className="flex-1 overflow-y-auto space-y-3 min-h-0 pr-1 scrollbar-thin">
        {sightings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-slate-600">
            <span className="text-3xl mb-2">👁️</span>
            <span className="text-xs">Nenhum rosto avistado</span>
          </div>
        ) : (
          Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <p className="text-[10px] text-slate-600 font-medium mb-1.5 sticky top-0 bg-slate-900/90 backdrop-blur-sm py-0.5">
                📅 {date}
              </p>
              <div className="space-y-1">
                {items.map(sighting => {
                  const config = PERMISSION_CONFIG[sighting.permission];
                  return (
                    <div
                      key={sighting.id}
                      className={cn(
                        'flex items-center gap-2.5 p-2 rounded-lg border transition-all',
                        config.bg,
                        config.border,
                        sighting.permission === 'unauthorized' && 'ring-1 ring-red-500/20',
                      )}
                    >
                      {/* Thumbnail */}
                      <div
                        className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 border-2"
                        style={{
                          borderColor: sighting.permission === 'authorized' ? '#10b981'
                            : sighting.permission === 'unauthorized' ? '#ef4444' : '#f59e0b',
                        }}
                      >
                        <img src={sighting.thumbnail} alt="" className="w-full h-full object-cover" />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs">{config.icon}</span>
                          <span className={cn('text-[11px] font-semibold', config.text)}>
                            {sighting.matchedName ?? 'Desconhecido'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[9px] text-slate-500 font-mono">
                            {formatTime(sighting.timestamp)}
                          </span>
                          {sighting.confidence > 0 && (
                            <span className="text-[9px] text-slate-600">
                              {Math.round(sighting.confidence * 100)}% confiança
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Permission badge */}
                      {sighting.permission === 'unauthorized' && (
                        <div className="flex-shrink-0">
                          <span className="text-[8px] font-bold bg-red-600 text-white px-1.5 py-0.5 rounded animate-pulse">
                            ⚠ ALERTA
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

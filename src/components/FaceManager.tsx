/**
 * FaceManager — Painel de gerenciamento de rostos.
 * 
 * Funcionalidades:
 * - Lista de rostos cadastrados com foto e permissão
 * - Cadastro via captura da webcam
 * - Editar nome, permissão, notas
 * - Adicionar mais fotos para melhorar reconhecimento
 * - Remover rostos
 */

import { useState } from 'react';
import { cn } from '@/utils/cn';
import type { FaceRecord, FacePermission } from '@/engine/faceDatabase';
import type { DetectedFace } from '@/engine/faceDetector';

interface FaceManagerProps {
  knownFaces: FaceRecord[];
  detectedFaces: DetectedFace[];
  modelsLoaded: boolean;
  modelsLoading: boolean;
  isActive: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onRegisterFromDetection: (face: DetectedFace, name: string, permission: FacePermission, notes?: string) => Promise<void>;
  onCaptureAndRegister: (video: HTMLVideoElement, name: string, permission: FacePermission, notes?: string) => Promise<void>;
  onAddDescriptor: (faceId: string, descriptor: number[], thumbnail: string) => Promise<void>;
  onUpdateFace: (id: string, updates: Partial<FaceRecord>) => Promise<void>;
  onRemoveFace: (id: string) => Promise<void>;
  onLoadModels: () => void;
}

const PERMISSION_LABELS: Record<FacePermission, { label: string; icon: string; color: string }> = {
  authorized: { label: 'Autorizado', icon: '✅', color: 'text-emerald-400' },
  unauthorized: { label: 'Não Autorizado', icon: '🚫', color: 'text-red-400' },
  unknown: { label: 'Desconhecido', icon: '❓', color: 'text-amber-400' },
};

export function FaceManager({
  knownFaces,
  detectedFaces,
  modelsLoaded,
  modelsLoading,
  isActive,
  videoRef,
  onRegisterFromDetection,
  onCaptureAndRegister,
  onAddDescriptor,
  onUpdateFace,
  onRemoveFace,
  onLoadModels,
}: FaceManagerProps) {
  const [activeTab, setActiveTab] = useState<'faces' | 'detected' | 'register'>('faces');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPermission, setEditPermission] = useState<FacePermission>('unknown');
  const [editNotes, setEditNotes] = useState('');

  // Register form state
  const [regName, setRegName] = useState('');
  const [regPermission, setRegPermission] = useState<FacePermission>('authorized');
  const [regNotes, setRegNotes] = useState('');
  const [registering, setRegistering] = useState(false);
  const [regMessage, setRegMessage] = useState<string | null>(null);

  // Confirm delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const startEdit = (face: FaceRecord) => {
    setEditingId(face.id);
    setEditName(face.name);
    setEditPermission(face.permission);
    setEditNotes(face.notes);
  };

  const saveEdit = async () => {
    if (editingId && editName.trim()) {
      await onUpdateFace(editingId, {
        name: editName.trim(),
        permission: editPermission,
        notes: editNotes,
      });
    }
    setEditingId(null);
  };

  const handleRegisterFromCamera = async () => {
    if (!regName.trim() || !videoRef.current) return;

    setRegistering(true);
    setRegMessage(null);

    try {
      await onCaptureAndRegister(videoRef.current, regName.trim(), regPermission, regNotes);
      setRegMessage('✅ Rosto cadastrado com sucesso!');
      setRegName('');
      setRegNotes('');
      setTimeout(() => setRegMessage(null), 3000);
    } catch (err) {
      setRegMessage(`❌ ${err instanceof Error ? err.message : 'Erro ao cadastrar'}`);
    } finally {
      setRegistering(false);
    }
  };

  const handleRegisterFromDetection = async (face: DetectedFace) => {
    if (!regName.trim()) {
      setRegMessage('⚠️ Digite um nome primeiro');
      return;
    }

    setRegistering(true);
    setRegMessage(null);

    try {
      await onRegisterFromDetection(face, regName.trim(), regPermission, regNotes);
      setRegMessage('✅ Rosto cadastrado com sucesso!');
      setRegName('');
      setRegNotes('');
      setActiveTab('faces');
      setTimeout(() => setRegMessage(null), 3000);
    } catch (err) {
      setRegMessage(`❌ ${err instanceof Error ? err.message : 'Erro ao cadastrar'}`);
    } finally {
      setRegistering(false);
    }
  };

  // Unregistered faces (detected but not matched)
  const unknownDetections = detectedFaces.filter(f => !f.matchedFace);

  return (
    <div className="space-y-3">
      {/* Models status */}
      {!modelsLoaded && (
        <div className="rounded-lg bg-slate-800/80 border border-slate-700 p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🧠</span>
            <div>
              <p className="text-xs font-semibold text-slate-200">Reconhecimento Facial</p>
              <p className="text-[10px] text-slate-500">Modelos de IA precisam ser carregados</p>
            </div>
          </div>
          <button
            onClick={onLoadModels}
            disabled={modelsLoading}
            className={cn(
              'w-full py-2 rounded-lg text-xs font-semibold transition-all',
              modelsLoading
                ? 'bg-blue-500/20 text-blue-400 cursor-wait'
                : 'bg-blue-600 hover:bg-blue-500 text-white',
            )}
          >
            {modelsLoading ? '⏳ Carregando modelos...' : '🚀 Carregar Modelos de IA'}
          </button>
        </div>
      )}

      {modelsLoaded && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 bg-slate-800/50 rounded-lg p-0.5">
            {[
              { id: 'faces' as const, label: 'Cadastrados', count: knownFaces.length, icon: '👥' },
              { id: 'detected' as const, label: 'Detectados', count: unknownDetections.length, icon: '👁️' },
              { id: 'register' as const, label: 'Cadastrar', icon: '➕' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium transition-all',
                  activeTab === tab.id
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-500 hover:text-slate-300',
                )}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={cn(
                    'text-[8px] px-1 py-0 rounded-full font-bold',
                    activeTab === tab.id ? 'bg-blue-500/30 text-blue-300' : 'bg-slate-700 text-slate-400',
                  )}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab: Known faces */}
          {activeTab === 'faces' && (
            <div className="space-y-1.5 max-h-[350px] overflow-y-auto scrollbar-thin pr-1">
              {knownFaces.length === 0 ? (
                <div className="flex flex-col items-center py-6 text-slate-600">
                  <span className="text-3xl mb-2">👤</span>
                  <span className="text-xs">Nenhum rosto cadastrado</span>
                  <span className="text-[10px] text-slate-700 mt-0.5">
                    Cadastre rostos na aba "Cadastrar"
                  </span>
                </div>
              ) : (
                knownFaces.map(face => {
                  const permInfo = PERMISSION_LABELS[face.permission];
                  const isEditing = editingId === face.id;
                  const isDeleting = confirmDeleteId === face.id;

                  return (
                    <div
                      key={face.id}
                      className="rounded-lg border border-slate-700/50 bg-slate-800/50 overflow-hidden"
                    >
                      <div className="flex items-center gap-2.5 p-2.5">
                        {/* Thumbnail */}
                        <div className="w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 border-2"
                          style={{
                            borderColor: face.permission === 'authorized' ? '#10b981'
                              : face.permission === 'unauthorized' ? '#ef4444' : '#f59e0b',
                          }}
                        >
                          <img src={face.thumbnail} alt={face.name} className="w-full h-full object-cover" />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              className="w-full bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs text-white outline-none focus:border-blue-500"
                              autoFocus
                            />
                          ) : (
                            <p className="text-xs font-semibold text-slate-200 truncate">{face.name}</p>
                          )}
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={cn('text-[10px] font-medium', permInfo.color)}>
                              {permInfo.icon} {permInfo.label}
                            </span>
                            <span className="text-[9px] text-slate-600">
                              · {face.descriptors.length} foto{face.descriptors.length > 1 ? 's' : ''}
                            </span>
                          </div>
                          {face.lastSeenAt && (
                            <p className="text-[9px] text-slate-600 mt-0.5">
                              Visto: {new Date(face.lastSeenAt).toLocaleString('pt-BR', { 
                                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' 
                              })}
                              {face.timesDetected > 0 && ` · ${face.timesDetected}×`}
                            </p>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => isEditing ? saveEdit() : startEdit(face)}
                            className="text-[10px] px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600"
                          >
                            {isEditing ? '💾' : '✏️'}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(isDeleting ? null : face.id)}
                            className="text-[10px] px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>

                      {/* Edit panel */}
                      {isEditing && (
                        <div className="px-2.5 pb-2.5 space-y-2 border-t border-slate-700/50 pt-2">
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">Permissão</label>
                            <div className="grid grid-cols-3 gap-1">
                              {(['authorized', 'unauthorized', 'unknown'] as const).map(p => (
                                <button
                                  key={p}
                                  onClick={() => setEditPermission(p)}
                                  className={cn(
                                    'text-[9px] py-1.5 rounded font-medium transition-all',
                                    editPermission === p
                                      ? p === 'authorized' ? 'bg-emerald-600 text-white'
                                        : p === 'unauthorized' ? 'bg-red-600 text-white'
                                        : 'bg-amber-600 text-white'
                                      : 'bg-slate-700 text-slate-400 hover:bg-slate-600',
                                  )}
                                >
                                  {PERMISSION_LABELS[p].icon} {PERMISSION_LABELS[p].label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">Notas</label>
                            <textarea
                              value={editNotes}
                              onChange={e => setEditNotes(e.target.value)}
                              rows={2}
                              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-[10px] text-white outline-none focus:border-blue-500 resize-none"
                              placeholder="Observações sobre esta pessoa..."
                            />
                          </div>
                          <button
                            onClick={saveEdit}
                            className="w-full py-1.5 rounded bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-500"
                          >
                            Salvar Alterações
                          </button>
                        </div>
                      )}

                      {/* Delete confirm */}
                      {isDeleting && (
                        <div className="px-2.5 pb-2.5 border-t border-red-500/30 pt-2 bg-red-500/5">
                          <p className="text-[10px] text-red-400 mb-2">
                            Remover <strong>{face.name}</strong> do banco de rostos?
                          </p>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => { onRemoveFace(face.id); setConfirmDeleteId(null); }}
                              className="flex-1 py-1.5 rounded bg-red-600 text-white text-[10px] font-semibold hover:bg-red-500"
                            >
                              Sim, remover
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="flex-1 py-1.5 rounded bg-slate-700 text-slate-300 text-[10px] hover:bg-slate-600"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Tab: Detected unknown faces */}
          {activeTab === 'detected' && (
            <div className="space-y-1.5 max-h-[350px] overflow-y-auto scrollbar-thin pr-1">
              {!isActive ? (
                <div className="flex flex-col items-center py-6 text-slate-600">
                  <span className="text-3xl mb-2">📸</span>
                  <span className="text-xs">Detecção não está ativa</span>
                  <span className="text-[10px] text-slate-700 mt-0.5">
                    Inicie a detecção facial para ver rostos
                  </span>
                </div>
              ) : unknownDetections.length === 0 ? (
                <div className="flex flex-col items-center py-6 text-slate-600">
                  <span className="text-3xl mb-2">✅</span>
                  <span className="text-xs">Nenhum rosto desconhecido</span>
                  <span className="text-[10px] text-slate-700 mt-0.5">
                    Todos os rostos estão identificados
                  </span>
                </div>
              ) : (
                unknownDetections.map(face => (
                  <div
                    key={face.id}
                    className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 flex items-center gap-2.5"
                  >
                    <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border-2 border-amber-500/50">
                      <img src={face.thumbnail} alt="Desconhecido" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-amber-400">❓ Desconhecido</p>
                      <p className="text-[9px] text-slate-500">Rosto não cadastrado</p>
                    </div>
                    <button
                      onClick={() => {
                        setActiveTab('register');
                        // Preencher com dados desta detecção
                        handleRegisterFromDetection(face);
                      }}
                      className="text-[10px] px-2.5 py-1.5 rounded bg-blue-600 text-white font-medium hover:bg-blue-500 flex-shrink-0"
                    >
                      Cadastrar
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tab: Register new face */}
          {activeTab === 'register' && (
            <div className="space-y-3">
              {/* Message */}
              {regMessage && (
                <div className={cn(
                  'p-2 rounded-lg text-xs',
                  regMessage.startsWith('✅') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
                  regMessage.startsWith('❌') ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
                  'bg-amber-500/10 text-amber-400 border border-amber-500/30',
                )}>
                  {regMessage}
                </div>
              )}

              {/* Name */}
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Nome da pessoa *</label>
                <input
                  type="text"
                  value={regName}
                  onChange={e => setRegName(e.target.value)}
                  placeholder="Ex: João Silva"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-blue-500 placeholder-slate-600"
                />
              </div>

              {/* Permission */}
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Permissão de acesso</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['authorized', 'unauthorized', 'unknown'] as const).map(p => {
                    const info = PERMISSION_LABELS[p];
                    return (
                      <button
                        key={p}
                        onClick={() => setRegPermission(p)}
                        className={cn(
                          'py-2 rounded-lg text-[10px] font-medium transition-all border',
                          regPermission === p
                            ? p === 'authorized' ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-400'
                              : p === 'unauthorized' ? 'bg-red-600/20 border-red-500/50 text-red-400'
                              : 'bg-amber-600/20 border-amber-500/50 text-amber-400'
                            : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-600',
                        )}
                      >
                        <span className="block text-sm mb-0.5">{info.icon}</span>
                        {info.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Notas (opcional)</label>
                <textarea
                  value={regNotes}
                  onChange={e => setRegNotes(e.target.value)}
                  rows={2}
                  placeholder="Informações adicionais..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-[10px] text-white outline-none focus:border-blue-500 resize-none placeholder-slate-600"
                />
              </div>

              {/* Capture button */}
              <button
                onClick={handleRegisterFromCamera}
                disabled={registering || !regName.trim() || !videoRef.current}
                className={cn(
                  'w-full py-2.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2',
                  registering
                    ? 'bg-blue-500/20 text-blue-400 cursor-wait'
                    : !regName.trim()
                      ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                      : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-500/20',
                )}
              >
                {registering ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Capturando rosto...
                  </>
                ) : (
                  <>
                    📸 Capturar da Câmera
                  </>
                )}
              </button>

              {/* Register from detected faces */}
              {unknownDetections.length > 0 && (
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1.5">
                    Ou cadastre um rosto já detectado:
                  </label>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {unknownDetections.map(face => (
                      <button
                        key={face.id}
                        onClick={() => handleRegisterFromDetection(face)}
                        disabled={registering || !regName.trim()}
                        className={cn(
                          'flex-shrink-0 w-16 rounded-lg overflow-hidden border-2 transition-all',
                          regName.trim()
                            ? 'border-amber-500/50 hover:border-blue-500 cursor-pointer'
                            : 'border-slate-700 opacity-50 cursor-not-allowed',
                        )}
                      >
                        <img src={face.thumbnail} alt="" className="w-full h-16 object-cover" />
                        <div className="bg-amber-500/20 py-0.5">
                          <span className="text-[8px] text-amber-400 font-medium">Cadastrar</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tips */}
              <div className="border border-dashed border-slate-700 rounded-lg p-2.5">
                <p className="text-[10px] text-slate-500 font-medium mb-1">💡 Dicas para melhor reconhecimento:</p>
                <ul className="text-[9px] text-slate-600 space-y-0.5">
                  <li>• Olhe diretamente para a câmera</li>
                  <li>• Boa iluminação no rosto</li>
                  <li>• Cadastre múltiplas fotos (ângulos diferentes)</li>
                  <li>• Evite óculos escuros na primeira foto</li>
                </ul>
              </div>

              {/* Add more descriptors to existing face */}
              {knownFaces.length > 0 && (
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1.5">
                    Melhorar reconhecimento (adicionar foto):
                  </label>
                  <div className="space-y-1">
                    {knownFaces.map(face => (
                      <button
                        key={face.id}
                        onClick={async () => {
                          if (!videoRef.current) return;
                          setRegistering(true);
                          try {
                            // Capturar novo descriptor
                            const canvas = document.createElement('canvas');
                            canvas.width = videoRef.current.videoWidth;
                            canvas.height = videoRef.current.videoHeight;
                            const ctx = canvas.getContext('2d');
                            if (!ctx) return;
                            ctx.drawImage(videoRef.current, 0, 0);
                            
                            // Usamos face-api diretamente aqui
                            const faceapi = await import('face-api.js');
                            const detection = await faceapi
                              .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 }))
                              .withFaceLandmarks()
                              .withFaceDescriptor();
                            
                            if (!detection) {
                              setRegMessage('❌ Nenhum rosto detectado na câmera');
                              return;
                            }

                            const descriptor = Array.from(detection.descriptor);
                            const box = detection.detection.box;
                            
                            // Crop thumbnail
                            const cropCanvas = document.createElement('canvas');
                            cropCanvas.width = 150;
                            cropCanvas.height = 150;
                            const cropCtx = cropCanvas.getContext('2d')!;
                            const pad = Math.max(box.width, box.height) * 0.3;
                            cropCtx.drawImage(canvas,
                              Math.max(0, box.x - pad), Math.max(0, box.y - pad),
                              box.width + pad * 2, box.height + pad * 2,
                              0, 0, 150, 150
                            );
                            const thumbnail = cropCanvas.toDataURL('image/jpeg', 0.7);

                            await onAddDescriptor(face.id, descriptor, thumbnail);
                            setRegMessage(`✅ Nova foto adicionada para ${face.name}`);
                          } catch {
                            setRegMessage('❌ Erro ao capturar');
                          } finally {
                            setRegistering(false);
                          }
                        }}
                        className="w-full flex items-center gap-2 p-2 rounded-lg bg-slate-800/80 border border-slate-700/50 hover:border-slate-600 transition-all text-left"
                      >
                        <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0">
                          <img src={face.thumbnail} alt="" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-medium text-slate-300 truncate">{face.name}</p>
                          <p className="text-[9px] text-slate-600">{face.descriptors.length} foto(s)</p>
                        </div>
                        <span className="text-[10px] text-blue-400">+📸</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

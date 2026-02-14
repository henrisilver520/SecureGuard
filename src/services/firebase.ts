/**
 * Firebase Service — Conexão e operações com Firestore.
 * 
 * Estrutura do Firestore:
 * - cameras/{cameraId} — dados da câmera
 * - persons/{personId} — banco de rostos com permissões
 * - events/{eventId} — log de eventos (motion, face, zone)
 * - stats/{date} — estatísticas diárias
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';


// ==================== ATENÇAO, ADICIONAR SUAS CREDENCIAIS  ====================
const firebaseConfig = {
  apiKey: "xxxxxx-xxxx-xxxxxxx",
  authDomain: "seurepositori-312dc.firebaseapp.com",
  projectId: "connectfamilia-312dc",
  storageBucket: "XXXXX-312dc.appspot.com",
  messagingSenderId: "79XXXXX8649",
  appId: "1:797813XXXXXXXXX1f8d81e8",
  measurementId: "GXXXXXXQ"
};
// ==================== ATENÇAO, ADICIONAR SUAS CREDENCIAIS  ====================





const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ==================== TYPES ====================

export type PersonPermission = 'authorized' | 'unauthorized' | 'visitor' | 'unknown';
export type EventSeverity = 'low' | 'medium' | 'high' | 'critical';
export type EventType = 'motion' | 'face_known' | 'face_unknown' | 'face_blocked' | 'zone_breach' | 'system';

export interface PersonRecord {
  id: string;
  name: string;
  role: string;
  permission: PersonPermission;
  descriptors: { id: string; descriptor: number[]; capturedAt: string }[];
  thumbnail: string;
  photos: string[];
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  totalSightings: number;
  notes: string;
}

export interface SecurityEvent {
  id: string;
  type: EventType;
  severity: EventSeverity;
  cameraId: string;
  cameraName: string;
  message: string;
  personId: string | null;
  personName: string | null;
  personPermission: PersonPermission | null;
  zoneName: string | null;
  zoneType: string | null;
  thumbnail: string;
  motionIntensity: number;
  timestamp: string;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
}

export interface CameraRecord {
  id: string;
  name: string;
  location: string;
  status: 'online' | 'offline' | 'detecting';
  lastSeen: string;
  thumbnail: string;
  zonesCount: number;
  personsDetected: number;
}

// Camera settings are stored separately to avoid bloating the cameras/{id} doc.
export type CameraSourceType = 'webcam' | 'ip';

export interface CameraSourceWebcam {
  type: 'webcam';
  deviceId?: string; // optional: let browser pick default
}

export interface CameraSourceIP {
  type: 'ip';
  /**
   * URL to an IP camera stream.
   * Notes:
   * - Browsers do NOT support RTSP directly; you need a gateway (WebRTC/HLS/MJPEG).
   * - For this project we support MJPEG-over-HTTP and any URL playable by <video>.
   */
  url: string;
  mode: 'mjpeg' | 'video';
}

export type CameraSource = CameraSourceWebcam | CameraSourceIP;

export interface CameraSettings {
  motionEnabled: boolean;
  faceEnabled: boolean;
  sensitivity: number; // 0..100
  zonesOnly: boolean;
  cooldownSec: number;
  soundOn: boolean;
}

export interface CameraZone {
  id: string;
  label: string;
  type: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sensitivity: number;
  active: boolean;
  alertLevel: EventSeverity;
}

export interface CameraConfig {
  id: string;
  name: string;
  location?: string;
  source: CameraSource;
  settings: CameraSettings;
  zones: CameraZone[];
  createdAt: string;
  updatedAt: string;
}

export interface DailyStats {
  date: string;
  totalEvents: number;
  totalMotion: number;
  totalFaces: number;
  knownFaces: number;
  unknownFaces: number;
  blockedAttempts: number;
  hourlyBreakdown: number[];
  topPersons: { name: string; count: number }[];
}

// ==================== CAMERA ====================

const CAMERA_ID = `cam_${navigator.userAgent.replace(/\W/g, '').slice(0, 12)}_${window.location.hostname}`;

export function getCameraId(): string {
  return CAMERA_ID;
}

/**
 * Multi-camera support: update a specific camera record.
 * Keep updateCamera() as a convenience for the local/default camera.
 */
export async function updateCameraFor(cameraId: string, data: Partial<CameraRecord>): Promise<void> {
  try {
    const ref = doc(db, 'cameras', cameraId);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, { ...data, lastSeen: new Date().toISOString() });
    } else {
      await setDoc(ref, {
        id: cameraId,
        name: data.name ?? 'Câmera',
        location: data.location ?? 'Local não definido',
        status: data.status ?? 'offline',
        lastSeen: new Date().toISOString(),
        thumbnail: data.thumbnail ?? '',
        zonesCount: data.zonesCount ?? 0,
        personsDetected: data.personsDetected ?? 0,
      });
    }
  } catch (e) {
    console.warn('Firebase camera update failed:', e);
  }
}

export async function updateCamera(data: Partial<CameraRecord>): Promise<void> {
  return updateCameraFor(CAMERA_ID, data);
}

// ==================== CAMERA CONFIG ====================

export async function getCameraConfig(cameraId: string): Promise<CameraConfig | null> {
  try {
    const ref = doc(db, 'camera_configs', cameraId);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() as CameraConfig) : null;
  } catch (e) {
    console.warn('Firebase getCameraConfig failed:', e);
    return null;
  }
}

export async function saveCameraConfig(config: CameraConfig): Promise<void> {
  try {
    await setDoc(doc(db, 'camera_configs', config.id), {
      ...config,
      updatedAt: new Date().toISOString(),
      _serverTimestamp: serverTimestamp(),
    });
  } catch (e) {
    console.warn('Firebase saveCameraConfig failed:', e);
  }
}

export async function updateCameraConfig(cameraId: string, updates: Partial<CameraConfig>): Promise<void> {
  try {
    await updateDoc(doc(db, 'camera_configs', cameraId), {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    // updateDoc requires doc to exist; fallback to setDoc with merge semantics.
    try {
      await setDoc(doc(db, 'camera_configs', cameraId), {
        ...updates,
        id: cameraId,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (err) {
      console.warn('Firebase updateCameraConfig failed:', err);
    }
  }
}

export function subscribeCameraConfig(cameraId: string, callback: (config: CameraConfig | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'camera_configs', cameraId), (snap) => {
    callback(snap.exists() ? (snap.data() as CameraConfig) : null);
  }, (err) => {
    console.warn('Firebase camera config subscription error:', err);
  });
}

// ==================== PERSONS ====================

export async function getAllPersons(): Promise<PersonRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'persons'));
    return snap.docs.map(d => d.data() as PersonRecord);
  } catch (e) {
    console.warn('Firebase getAllPersons failed:', e);
    return [];
  }
}

export async function savePerson(person: PersonRecord): Promise<void> {
  try {
    await setDoc(doc(db, 'persons', person.id), person);
  } catch (e) {
    console.warn('Firebase savePerson failed:', e);
  }
}

export async function updatePerson(id: string, updates: Partial<PersonRecord>): Promise<void> {
  try {
    await updateDoc(doc(db, 'persons', id), { ...updates, updatedAt: new Date().toISOString() });
  } catch (e) {
    console.warn('Firebase updatePerson failed:', e);
  }
}

export async function deletePerson(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'persons', id));
  } catch (e) {
    console.warn('Firebase deletePerson failed:', e);
  }
}

export function subscribePersons(callback: (persons: PersonRecord[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'persons'), (snap) => {
    callback(snap.docs.map(d => d.data() as PersonRecord));
  }, (err) => {
    console.warn('Firebase persons subscription error:', err);
  });
}

// ==================== EVENTS ====================

export async function saveEvent(event: SecurityEvent): Promise<void> {
  try {
    await setDoc(doc(db, 'events', event.id), {
      ...event,
      _serverTimestamp: serverTimestamp(),
    });
  } catch (e) {
    console.warn('Firebase saveEvent failed:', e);
  }
}

export async function getRecentEvents(count = 100): Promise<SecurityEvent[]> {
  try {
    const q = query(
      collection(db, 'events'),
      orderBy('timestamp', 'desc'),
      limit(count)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as SecurityEvent);
  } catch (e) {
    console.warn('Firebase getRecentEvents failed:', e);
    return [];
  }
}

export async function acknowledgeEvent(eventId: string, by: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'events', eventId), {
      acknowledged: true,
      acknowledgedBy: by,
      acknowledgedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('Firebase acknowledgeEvent failed:', e);
  }
}

export function subscribeEvents(count: number, callback: (events: SecurityEvent[]) => void): Unsubscribe {
  const q = query(
    collection(db, 'events'),
    orderBy('timestamp', 'desc'),
    limit(count)
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => d.data() as SecurityEvent));
  }, (err) => {
    console.warn('Firebase events subscription error:', err);
  });
}

export async function getEventsByPerson(personId: string): Promise<SecurityEvent[]> {
  try {
    const q = query(
      collection(db, 'events'),
      where('personId', '==', personId),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as SecurityEvent);
  } catch (e) {
    console.warn('Firebase getEventsByPerson failed:', e);
    return [];
  }
}

export async function getCriticalEvents(): Promise<SecurityEvent[]> {
  try {
    const q = query(
      collection(db, 'events'),
      where('severity', '==', 'critical'),
      where('acknowledged', '==', false),
      orderBy('timestamp', 'desc'),
      limit(20)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as SecurityEvent);
  } catch (e) {
    console.warn('Firebase getCriticalEvents failed:', e);
    return [];
  }
}

// ==================== STATS ====================

export async function updateDailyStats(event: SecurityEvent): Promise<void> {
  try {
    const dateKey = new Date(event.timestamp).toISOString().split('T')[0];
    const hour = new Date(event.timestamp).getHours();
    const ref = doc(db, 'stats', dateKey);
    const existing = await getDoc(ref);

    if (existing.exists()) {
      const data = existing.data() as DailyStats;
      const hourly = [...(data.hourlyBreakdown || new Array(24).fill(0))];
      hourly[hour] = (hourly[hour] || 0) + 1;

      await updateDoc(ref, {
        totalEvents: (data.totalEvents || 0) + 1,
        totalMotion: (data.totalMotion || 0) + (event.type === 'motion' ? 1 : 0),
        totalFaces: (data.totalFaces || 0) + (event.type.startsWith('face') ? 1 : 0),
        knownFaces: (data.knownFaces || 0) + (event.type === 'face_known' ? 1 : 0),
        unknownFaces: (data.unknownFaces || 0) + (event.type === 'face_unknown' ? 1 : 0),
        blockedAttempts: (data.blockedAttempts || 0) + (event.type === 'face_blocked' ? 1 : 0),
        hourlyBreakdown: hourly,
      });
    } else {
      const hourly = new Array(24).fill(0);
      hourly[hour] = 1;
      await setDoc(ref, {
        date: dateKey,
        totalEvents: 1,
        totalMotion: event.type === 'motion' ? 1 : 0,
        totalFaces: event.type.startsWith('face') ? 1 : 0,
        knownFaces: event.type === 'face_known' ? 1 : 0,
        unknownFaces: event.type === 'face_unknown' ? 1 : 0,
        blockedAttempts: event.type === 'face_blocked' ? 1 : 0,
        hourlyBreakdown: hourly,
        topPersons: [],
      });
    }
  } catch (e) {
    console.warn('Firebase updateDailyStats failed:', e);
  }
}

export async function getTodayStats(): Promise<DailyStats | null> {
  try {
    const dateKey = new Date().toISOString().split('T')[0];
    const snap = await getDoc(doc(db, 'stats', dateKey));
    return snap.exists() ? (snap.data() as DailyStats) : null;
  } catch {
    return null;
  }
}

export async function getStatsRange(days: number): Promise<DailyStats[]> {
  try {
    const results: DailyStats[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const snap = await getDoc(doc(db, 'stats', key));
      if (snap.exists()) {
        results.push(snap.data() as DailyStats);
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ==================== HELPERS ====================

export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export function findBestMatch(
  descriptor: number[],
  persons: PersonRecord[],
  threshold = 0.5
): { person: PersonRecord; distance: number; confidence: number } | null {
  let best: PersonRecord | null = null;
  let bestDist = Infinity;

  for (const p of persons) {
    for (const fd of p.descriptors) {
      const dist = euclideanDistance(descriptor, fd.descriptor);
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
  }

  if (best && bestDist < threshold) {
    return { person: best, distance: bestDist, confidence: Math.max(0, 1 - bestDist / threshold) };
  }
  return null;
}

export { db, Timestamp };

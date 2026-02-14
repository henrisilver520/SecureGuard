export type MotionAlertLevel = 'low' | 'medium' | 'high' | 'critical';

export interface MotionZone {
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
  alertLevel: MotionAlertLevel;
}

type SourceEl = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

function sourceReady(el: SourceEl): boolean {
  if (el instanceof HTMLVideoElement) return el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0;
  if (el instanceof HTMLImageElement) return el.complete && el.naturalWidth > 0 && el.naturalHeight > 0;
  return el.width > 0 && el.height > 0;
}

/**
 * MotionEngine
 * - Downscales frames (default 160x120) for predictable CPU cost.
 * - Works with HTMLVideoElement, HTMLImageElement (MJPEG) and Canvas.
 */
export class MotionEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private prevFrame: ImageData | null = null;
  private W = 160;
  private H = 120;

  constructor(width = 160, height = 120) {
    this.W = width;
    this.H = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  reset() {
    this.prevFrame = null;
  }

  analyze(source: SourceEl, zones: MotionZone[], sensitivity: number): {
    intensity: number;
    mask: boolean[][];
    zoneIntensities: Map<string, number>;
    alertedZones: { zone: MotionZone; percent: number }[];
  } {
    if (!sourceReady(source)) {
      return { intensity: 0, mask: [], zoneIntensities: new Map(), alertedZones: [] };
    }

    const { W: w, H: h } = this;
    this.ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
    const frame = this.ctx.getImageData(0, 0, w, h);

    if (!this.prevFrame) {
      this.prevFrame = frame;
      return { intensity: 0, mask: [], zoneIntensities: new Map(), alertedZones: [] };
    }

    // Sensitivity 0..100 -> threshold ~[5..30]
    const threshold = Math.max(5, 30 - (sensitivity - 50) * 0.5);
    const curr = frame.data;
    const prev = this.prevFrame.data;

    const gridW = Math.ceil(w / 8);
    const gridH = Math.ceil(h / 8);
    const mask: boolean[][] = Array.from({ length: gridH }, () => Array(gridW).fill(false));
    const diffMap = new Float32Array(w * h);

    let changed = 0;
    for (let i = 0; i < curr.length; i += 4) {
      const cL = curr[i] * 0.299 + curr[i + 1] * 0.587 + curr[i + 2] * 0.114;
      const pL = prev[i] * 0.299 + prev[i + 1] * 0.587 + prev[i + 2] * 0.114;
      const d = Math.abs(cL - pL);
      const px = i / 4;
      diffMap[px] = d;
      if (d > threshold) {
        changed++;
        const x = px % w;
        const y = Math.floor(px / w);
        const gx = Math.floor(x / 8);
        const gy = Math.floor(y / 8);
        if (gx < gridW && gy < gridH) mask[gy][gx] = true;
      }
    }

    // Normalize to a more "human" % (tuned for low-res diff)
    const intensity = Math.min(100, (changed / (w * h)) * 100 * 15);

    const zoneIntensities = new Map<string, number>();
    const alertedZones: { zone: MotionZone; percent: number }[] = [];

    for (const z of zones) {
      if (!z.active) continue;

      const x1 = Math.floor(z.x * w);
      const y1 = Math.floor(z.y * h);
      const x2 = Math.min(w, Math.ceil((z.x + z.width) * w));
      const y2 = Math.min(h, Math.ceil((z.y + z.height) * h));

      let total = 0;
      let zChanged = 0;

      const zt = Math.max(3, threshold - (z.sensitivity - 50) * 0.4);
      for (let py = y1; py < y2; py++) {
        for (let px = x1; px < x2; px++) {
          total++;
          if (diffMap[py * w + px] > zt) zChanged++;
        }
      }

      const zPercent = total > 0 ? (zChanged / total) * 100 : 0;
      zoneIntensities.set(z.id, Math.min(100, zPercent * 3));

      const thresholds = { critical: 2, high: 5, medium: 10, low: 20 } as const;
      if (zPercent > (thresholds[z.alertLevel] ?? 10)) {
        alertedZones.push({ zone: z, percent: Math.round(zPercent) });
      }
    }

    this.prevFrame = frame;
    return {
      intensity: Math.round(intensity),
      mask,
      zoneIntensities,
      alertedZones,
    };
  }

  captureSnapshot(source: SourceEl, zones?: { zone: MotionZone; percent: number }[]): string {
    if (!sourceReady(source)) return '';

    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 240;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(source as CanvasImageSource, 0, 0, 320, 240);

    if (zones) {
      for (const { zone } of zones) {
        ctx.strokeStyle = zone.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(zone.x * 320, zone.y * 240, zone.width * 320, zone.height * 240);
        ctx.fillStyle = zone.color;
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(zone.label, zone.x * 320 + 3, zone.y * 240 + 12);
      }
    }

    return c.toDataURL('image/jpeg', 0.6);
  }
}

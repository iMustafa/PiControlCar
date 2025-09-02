export const PKT_SIZE = 16 as const;

export function clamp01(v: number) {
  return Math.max(-1, Math.min(1, v));
}

export function toI16_1000(v: number) {
  return (clamp01(v) * 1000) | 0;
}

export function packFrameBE(
  seq: number,
  throttle: number,
  steering: number,
  buttons: number = 0,
  flags: number = 0
): ArrayBuffer {
  const buf = new ArrayBuffer(PKT_SIZE);
  const dv = new DataView(buf);
  dv.setUint32(0, (seq >>> 0));                          // seq
  dv.setUint32(4, ((performance.now() | 0) >>> 0));      // ts_ms
  dv.setInt16(8,  toI16_1000(throttle));                 // throttle
  dv.setInt16(10, toI16_1000(steering));                 // steering
  dv.setUint16(12, (buttons & 0xffff) >>> 0);            // buttons
  dv.setUint8(14,  flags & 0xff);                        // flags
  dv.setUint8(15,  0);                                   // reserved
  return buf;
}

export function bufferToHex(buf: ArrayBuffer) {
  const v = new Uint8Array(buf);
  return Array.from(v).map(b => b.toString(16).padStart(2, "0")).join(" ");
}



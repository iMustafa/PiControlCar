import { useEffect, useRef, useState } from "react";
import { packFrameBE, bufferToHex, clamp01 } from "../lib/binary";

export type UseGamepadOptions = {
  pollHz?: number;          // default 60
  deadzone?: number;        // default 0.1
  axisThrottle?: number;    // default 1 (left stick Y on Xbox = index 1)
  axisSteering?: number;    // default 0 (left stick X = index 0)
  invertThrottle?: boolean; // default true (up is negative on many pads)
  invertSteering?: boolean; // default false
  onFrame?: (buf: ArrayBuffer, floats: { throttle: number; steering: number; buttonsMask: number; seq: number }) => void;
  logHex?: boolean;         // default true: print hex to console
  send?: (buf: ArrayBuffer) => boolean; // optional sender (e.g., WebRTC DC)
};

export type GamepadState = {
  connected: boolean;
  id: string | null;
  throttle: number;  // [-1..1]
  steering: number;  // [-1..1]
  buttonsMask: number;
  seq: number;
};

function applyDeadzone(x: number, dz: number) {
  const ax = Math.abs(x);
  if (ax < dz) return 0;
  // optional rescale to full range after deadzone:
  const sign = Math.sign(x);
  const t = (ax - dz) / (1 - dz);
  return clamp01(sign * t);
}

function buildButtonsMask(gp: Gamepad): number {
  // Map first 16 buttons into a u16 bitmask
  let mask = 0;
  const n = Math.min(16, gp.buttons.length);
  for (let i = 0; i < n; i++) {
    if (gp.buttons[i]?.pressed) mask |= (1 << i);
  }
  return mask >>> 0;
}

export function useGamepad(opts: UseGamepadOptions = {}): GamepadState {
  const {
    pollHz = 60,
    deadzone = 0.1,
    axisThrottle = 1,
    axisSteering = 0,
    invertThrottle = true,
    invertSteering = false,
    onFrame,
    logHex = true,
  } = opts;

  const [state, setState] = useState<GamepadState>({
    connected: false,
    id: null,
    throttle: 0,
    steering: 0,
    buttonsMask: 0,
    seq: 0,
  });

  const rafRef = useRef<number | null>(null);
  const seqRef = useRef(0);
  const tickInterval = Math.max(1, Math.round(1000 / pollHz));
  const lastTickRef = useRef(0);

  useEffect(() => {
    let mounted = true;

    function update() {
      const now = performance.now();
      rafRef.current = requestAnimationFrame(update);

      if (now - lastTickRef.current < tickInterval) return;
      lastTickRef.current = now;

      const pads = navigator.getGamepads?.() ?? [];
      const gp = pads.find(Boolean) as Gamepad | null;

      if (!gp || !gp.connected) {
        if (mounted) setState(s => ({ ...s, connected: false, id: null }));
        return;
      }

      const ax = gp.axes ?? [];
      let throttle = ax[axisThrottle] ?? 0;
      let steering = ax[axisSteering] ?? 0;

      // Invert if needed (common: throttle up = negative axis)
      if (invertThrottle) throttle = -throttle;
      if (invertSteering) steering = -steering;

      // Deadzone + clamp
      throttle = applyDeadzone(throttle, deadzone);
      steering = applyDeadzone(steering, deadzone);

      const buttonsMask = buildButtonsMask(gp);
      const seq = (seqRef.current = (seqRef.current + 1) >>> 0);

      const buf = packFrameBE(seq, throttle, steering, buttonsMask, /*flags*/0);

      if (logHex) {
        // Print: seq, floats, and 16-byte hex
        // eslint-disable-next-line no-console
        console.log(
          `[ctrl] seq=${seq} thr=${throttle.toFixed(3)} ste=${steering.toFixed(3)} btn=0x${buttonsMask.toString(16).padStart(4,"0")} | ${bufferToHex(buf)}`
        );
      }

      if (opts.send) {
        const ok = opts.send(buf);
        if (!ok) {
          // eslint-disable-next-line no-console
          console.debug('[ctrl] send skipped (channel not open)');
        }
      }
      onFrame?.(buf, { throttle, steering, buttonsMask, seq });

      if (mounted) {
        setState({
          connected: true,
          id: gp.id || "gamepad",
          throttle,
          steering,
          buttonsMask,
          seq,
        });
      }
    }

    rafRef.current = requestAnimationFrame(update);
    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    pollHz, deadzone, axisThrottle, axisSteering, invertThrottle, invertSteering, onFrame, logHex, tickInterval
  ]);

  return state;
}

export default useGamepad;



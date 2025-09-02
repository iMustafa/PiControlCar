import { useEffect, useMemo, useRef, useState } from 'react';
import { WebRtcController } from '../lib/webrtc';

export function useWebRtc(baseUrl: string, roomId: string | null, opts?: { enableMedia?: boolean; dataChannelLabel?: string }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<WebRtcController | null>(null);

  const controller = useMemo(() => {
    if (!roomId) {
      controllerRef.current = null;
      return null;
    }
    const ctrl = new WebRtcController({ baseUrl, roomId, enableMedia: opts?.enableMedia, dataChannelLabel: opts?.dataChannelLabel });
    controllerRef.current = ctrl;
    return ctrl;
  }, [baseUrl, roomId, opts?.enableMedia, opts?.dataChannelLabel]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (controller) {
          await controller.ensureLocalStream();
          if (!cancelled) setReady(true);
          controller.setDataHandler((data) => {
            // eslint-disable-next-line no-console
            console.log('[dc<-]', data);
          });
        } else {
          setReady(false);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      controllerRef.current?.close().catch(() => {});
    };
  }, [controller]);

  return {
    controller,
    localStream: controller?.getLocalStream() ?? null,
    remoteStream: controller?.getRemoteStream() ?? new MediaStream(),
    ready,
    error,
  } as const;
}

import { useEffect, useRef } from 'react';

type Props = {
  local: MediaStream | null;
  remote: MediaStream;
};

export function VideoPanels({ local, remote }: Props) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localRef.current && local) localRef.current.srcObject = local;
  }, [local]);

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remote;
  }, [remote]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <video ref={localRef} autoPlay muted playsInline style={{ width: '100%', background: '#000' }} />
      <video ref={remoteRef} autoPlay playsInline style={{ width: '100%', background: '#000' }} />
    </div>
  );
}



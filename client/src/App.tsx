import { useMemo, useState } from 'react'
import './App.css'
import { useWebRtc } from './hooks/useWebRtc'
import { VideoPanels } from './components/VideoPanels'
import useGamepad from './hooks/useGamepad';

function App() {
  const [hz, setHz] = useState(60);
  const state = useGamepad({
    pollHz: hz,
    deadzone: 0.08,
    axisThrottle: 1,
    axisSteering: 0,
    invertThrottle: true,
    invertSteering: false,
    send: (buf) => (controlCtrl ?? controller)?.sendData(buf) ?? false,
    logHex: true,
  });

  const [roomIdInput, setRoomIdInput] = useState('room-1')
  const [joinedRoomId, setJoinedRoomId] = useState<string | null>(null)
  const [controlRoomId, setControlRoomId] = useState<string | null>(null)

  const baseUrl = useMemo(() => `https://picar-e09b89d86d10.herokuapp.com/`, [])
  const { controller, localStream, remoteStream, ready, error } = useWebRtc(baseUrl, joinedRoomId, { enableMedia: true })
  const { controller: controlCtrl } = useWebRtc(baseUrl, controlRoomId, { enableMedia: false, dataChannelLabel: 'control' })

  return (
    <>
      <div style={{ padding: 16 }}>
        <h2>WebRTC A/V with Auto-Reconnect</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={roomIdInput} onChange={(e) => setRoomIdInput(e.target.value)} placeholder="room id" />
          <button disabled={!roomIdInput} onClick={() => setJoinedRoomId(roomIdInput)}>Join</button>
          <button onClick={() => { controller?.close(); setJoinedRoomId(null); }} disabled={!joinedRoomId}>Leave</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={controlRoomId ?? ''} onChange={(e) => setControlRoomId(e.target.value || null)} placeholder="room id (control)" />
          <button disabled={!roomIdInput} onClick={() => setControlRoomId(roomIdInput)}>Use media room id</button>
          <button onClick={() => { controlCtrl?.close(); setControlRoomId(null); }} disabled={!controlRoomId}>Close control</button>
        </div>
        {error && <div style={{ color: 'red' }}>{error}</div>}
        {ready && <VideoPanels local={localStream} remote={remoteStream} />}
        <p style={{ marginTop: 12, color: '#666' }}>ICE auto-restart is enabled per RTCPeerConnection.restartIce.</p>
      </div>
      <div style={{ fontFamily: "system-ui", padding: 16 }}>
        <h2>useGamepad demo</h2>
        <p>Status: {state.connected ? "🎮 connected" : "— not connected —"} {state.id && `(${state.id})`}</p>
        <p>Throttle: {state.throttle.toFixed(3)} | Steering: {state.steering.toFixed(3)} | Buttons: 0x{state.buttonsMask.toString(16).padStart(4, "0")}</p>
        <label>
          Poll Hz:
          <input type="number" value={hz} onChange={e => setHz(Number(e.target.value) || 60)} min={10} max={240} step={10} />
        </label>
        <p>Open the console to see 16-byte hex frames printed at the selected rate.</p>
        <p><small>Tip: press buttons and move sticks to watch the bytes change.</small></p>
      </div>
    </>
  )
}

export default App;
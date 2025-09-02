import argparse
import asyncio
from typing import Any, Dict, Optional

import socketio
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.signaling import BYE
from ExampleController.vehicle_controller import VehicleController


class TextRtcClient:
    def __init__(self, base_url: str, room_id: str, name: str) -> None:
        self.base_url = base_url.rstrip('/')
        self.room_id = room_id
        self.name = name

        self.pc: RTCPeerConnection = RTCPeerConnection()
        self.channel = None

        # Perfect negotiation flags
        self.making_offer: bool = False
        self.ignore_offer: bool = False
        self.polite: bool = False
        self.initiator: bool = False

        # Socket.IO async client
        self.sio = socketio.AsyncClient(reconnection=True)

        # Wire RTCPeerConnection events
        @self.pc.on("negotiationneeded")
        async def on_negotiationneeded() -> None:
            await self._negotiate()

        # Note: we rely on non-trickle by sending SDP after ICE gathering completes.

        @self.pc.on("iceconnectionstatechange")
        async def on_iceconnectionstatechange() -> None:
            state = self.pc.iceConnectionState
            print(f"[rtc] iceConnectionState -> {state}")
            if state == "failed":
                # Manual ICE restart for aiortc: create offer with iceRestart=True
                await self._negotiate(ice_restart=True)

        @self.pc.on("datachannel")
        def on_datachannel(channel) -> None:  # type: ignore[no-redef]
            print(f"[rtc] data channel created by remote: {channel.label}")
            self.channel = channel
            self._bind_channel_handlers()

        # Wire Socket.IO events
        @self.sio.event
        async def connect() -> None:  # type: ignore[no-redef]
            print("[sio] connected")
            await self.sio.emit("room:join", self.room_id)

        @self.sio.on("room:role")
        async def on_role(data: Dict[str, Any]) -> None:  # type: ignore[no-redef]
            self.initiator = bool(data.get("initiator", False))
            self.polite = bool(data.get("polite", False))
            print(f"[sio] role: initiator={self.initiator} polite={self.polite}")
            if self.initiator and self.channel is None:
                self.channel = self.pc.createDataChannel("control")
                self._bind_channel_handlers()
                # Proactively negotiate to create the data channel
                await self._negotiate()

        @self.sio.on("peer:ready")
        async def on_peer_ready() -> None:  # type: ignore[no-redef]
            print("[sio] peer ready")
            if self.initiator:
                await self._negotiate()

        @self.sio.on("signal:offer")
        async def on_offer(payload: Dict[str, Any]) -> None:  # type: ignore[no-redef]
            sdp = payload["sdp"]
            polite = bool(payload.get("polite", False))
            self.polite = polite
            offer_collision = self.making_offer or self.pc.signalingState != "stable"
            self.ignore_offer = (not self.polite) and offer_collision
            if self.ignore_offer:
                print("[sio] ignoring offer (collision and impolite)")
                return
            print("[sio] received offer -> setRemoteDescription")
            await self.pc.setRemoteDescription(RTCSessionDescription(sdp=sdp["sdp"], type=sdp["type"]))
            answer = await self.pc.createAnswer()
            await self.pc.setLocalDescription(answer)
            await self._wait_ice_gathering_complete()
            await self.sio.emit("signal:answer", {"sdp": {
                "type": self.pc.localDescription.type,
                "sdp": self.pc.localDescription.sdp,
            }, "roomId": self.room_id})

        @self.sio.on("signal:answer")
        async def on_answer(payload: Dict[str, Any]) -> None:  # type: ignore[no-redef]
            sdp = payload["sdp"]
            if self.pc.signalingState == "have-local-offer":
                print("[sio] received answer -> setRemoteDescription")
                await self.pc.setRemoteDescription(RTCSessionDescription(sdp=sdp["sdp"], type=sdp["type"]))

        @self.sio.on("signal:candidate")
        async def on_candidate(payload: Dict[str, Any]) -> None:  # type: ignore[no-redef]
            candidate = payload["candidate"]
            try:
                await self.pc.addIceCandidate(candidate)
            except Exception as e:  # Ignore if rolling back
                if not self.ignore_offer:
                    raise e

        @self.sio.on("peer:left")
        async def on_peer_left() -> None:  # type: ignore[no-redef]
            print("[sio] peer left")

    def _bind_channel_handlers(self) -> None:
        assert self.channel is not None

        @self.channel.on("open")
        def on_open() -> None:  # type: ignore[no-redef]
            print("[dc] open")

        @self.channel.on("message")
        def on_message(message: Any) -> None:  # type: ignore[no-redef]
            if isinstance(message, (bytes, bytearray, memoryview)):
                b = bytes(message)
                if len(b) >= 16:
                    seq, ts_ms, throttle, steering, buttons, flags = self._parse_frame(b[:16])
                    th, st = self.vehicle.update(throttle, steering)
                    print(f"[dc] seq={seq} ts={ts_ms} thr={throttle:.3f}->{th:.3f} ste={steering:.3f}->{st:.3f} btn=0x{buttons:04x} flg=0x{flags:02x}")
                else:
                    print(f"[dc] rx {len(b)} bytes: ", b.hex(" "))
                # send back acknowledgment: single null byte
                self.channel.send(b"\x00")
            else:
                print(f"[dc] rx text: {message}")

    async def _negotiate(self, ice_restart: bool = False) -> None:
        if self.pc.isClosed:  # type: ignore[attr-defined]
            return
        try:
            self.making_offer = True
            offer = await self.pc.createOffer(iceRestart=ice_restart)  # type: ignore[arg-type]
            await self.pc.setLocalDescription(offer)
            await self._wait_ice_gathering_complete()
            await self.sio.emit("signal:offer", {"sdp": {
                "type": self.pc.localDescription.type,
                "sdp": self.pc.localDescription.sdp,
            }, "roomId": self.room_id})
            print("[sio] sent offer")
        finally:
            self.making_offer = False

    async def _wait_ice_gathering_complete(self) -> None:
        # Wait until ICE gathering completes so SDP includes candidates (non-trickle style)
        for _ in range(50):
            if self.pc.iceGatheringState == "complete":
                return
            await asyncio.sleep(0.1)

    async def run(self) -> None:
        await self.sio.connect(self.base_url, transports=["websocket", "polling"])  # allow fallback
        # Hardware-driving vehicle controller (uses ExampleController GPIO classes)
        self.vehicle = VehicleController()
        print("[sio] connecting to", self.base_url)
        # Keep running until Ctrl+C
        try:
            await self.sio.wait()
        except KeyboardInterrupt:
            pass
        finally:
            await self.close()

    async def close(self) -> None:
        try:
            await self.sio.disconnect()
        except Exception:
            pass
        try:
            await self.pc.close()
        except Exception:
            pass

    @staticmethod
    def _parse_frame(b: bytes):
        """Parse 16-byte big-endian frame.
        Layout:
          0: u32 seq
          4: u32 ts_ms
          8: i16 throttle (×1000)
         10: i16 steering (×1000)
         12: u16 buttons
         14: u8  flags
         15: u8  reserved
        """
        import struct
        seq, ts_ms, thr_i16, ste_i16, buttons, flags, _ = struct.unpack(
            ">IIhhHBB", b
        )
        throttle = max(-1.0, min(1.0, thr_i16 / 1000.0))
        steering = max(-1.0, min(1.0, ste_i16 / 1000.0))
        return seq, ts_ms, throttle, steering, buttons, flags


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="WebRTC text client (data channel only)")
    parser.add_argument("--base-url", default="https://picar-e09b89d86d10.herokuapp.com/", help="Signaling server base URL")
    parser.add_argument("--room-id", required=True, help="Room id to join")
    parser.add_argument("--name", default="python", help="Client name tag")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    client = TextRtcClient(base_url=args.base_url, room_id=args.room_id, name=args.name)
    await client.run()


if __name__ == "__main__":
    asyncio.run(main())



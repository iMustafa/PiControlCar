# Python RTC Text Client

Async Socket.IO + aiortc client that joins a room and exchanges text on a WebRTC data channel (no audio/video).

## Setup
```
cd controller
python -m venv .venv
. .venv/Scripts/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Run
```
python rtc_text_client.py --base-url http://snowball.local:5174 --room-id room-1 --name py1
```
Open the web client in two tabs or one tab plus this Python client, join the same room id.

## Notes
- Uses perfect negotiation flags similar to the web client.
- On ICE failure, sends a new offer with `iceRestart=True` (aiortc equivalent of `restartIce()`).


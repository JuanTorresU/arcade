#!/usr/bin/env python3
"""
TikTok Listener — Conecta al live, extrae regalos/follows/likes y envía eventos al Control Server.
No toca el juego directo. Eventos normalizados vía WebSocket.
"""
import os
import sys
import json
import asyncio
import logging
from threading import Thread

try:
    from TikTokLive import TikTokLiveClient
    from TikTokLive.events import ConnectEvent, GiftEvent, LikeEvent, FollowEvent
except ImportError:
    print("Instala: pip install TikTokLive")
    sys.exit(1)

try:
    import websocket
except ImportError:
    print("Instala: pip install websocket-client")
    sys.exit(1)

LOG = logging.getLogger("listener")
LOG.setLevel(logging.INFO)
LOG.addHandler(logging.StreamHandler())

WS_URL = os.environ.get("ARCADE_WS", "ws://localhost:8765")
TIKTOK_USER = os.environ.get("TIKTOK_USERNAME", "")

ws_conn = None


def send_event(event_dict):
    global ws_conn
    if ws_conn and ws_conn.connected:
        try:
            ws_conn.send(json.dumps({"event": event_dict}))
        except Exception as e:
            LOG.warning("WebSocket send error: %s", e)


def ws_loop():
    global ws_conn
    while True:
        try:
            ws_conn = websocket.create_connection(WS_URL)
            LOG.info("Conectado al Control Server %s", WS_URL)
            while True:
                ws_conn.recv()
        except Exception as e:
            LOG.warning("WebSocket: %s. Reintento en 3s...", e)
        import time
        time.sleep(3)


def run_ws_thread():
    t = Thread(target=ws_loop, daemon=True)
    t.start()


async def main():
    if not TIKTOK_USER:
        LOG.error("Define TIKTOK_USERNAME (tu usuario de TikTok para el live)")
        return

    run_ws_thread()
    await asyncio.sleep(1)

    client = TikTokLiveClient(unique_id=TIKTOK_USER)

    @client.on(ConnectEvent)
    async def on_connect(_):
        LOG.info("Conectado al live de @%s", TIKTOK_USER)

    @client.on(GiftEvent)
    async def on_gift(event):
        gift = event.gift
        name = getattr(gift, "name", None) or getattr(gift, "gift_id", None) or str(gift)
        repeat = getattr(gift, "repeat_count", 1) or getattr(gift, "repeatCount", 1)
        send_event({
            "type": "gift",
            "id": name,
            "name": name,
            "count": int(repeat),
            "user": event.user.nickname if event.user else "?"
        })

    @client.on(LikeEvent)
    async def on_like(event):
        send_event({
            "type": "like",
            "id": "Like",
            "count": event.count,
            "user": event.user.nickname if event.user else "?"
        })

    @client.on(FollowEvent)
    async def on_follow(event):
        send_event({
            "type": "follow",
            "id": "follow",
            "count": 1,
            "user": event.user.nickname if event.user else "?"
        })

    await client.run()


if __name__ == "__main__":
    asyncio.run(main())

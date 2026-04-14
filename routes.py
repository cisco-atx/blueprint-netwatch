import json
import time

from flask import Response, jsonify, render_template, request, current_app

from .services import Watcher

watcher_instance = None

def render_netwatch():
    """Renders the NetWatch page."""
    return render_template("netwatch.html")

def start_watch():
    """Starts the watcher based on the provided devices and configuration."""
    global watcher_instance
    if watcher_instance and watcher_instance.is_running:
        return jsonify({"status": "already_running"})

    payload = request.json or {}
    devices = [d.strip() for d in payload.get("devices", "").split(",") if d.strip()]
    connector = payload.get("config")

    watcher_instance = Watcher(devices, connector)
    watcher_instance.start()
    return jsonify({"status": "started"})

def stop_watch():
    """Stops the watcher if it is currently running."""
    global watcher_instance
    if watcher_instance:
        watcher_instance.stop()
    return jsonify({"status": "stopped"})

def clear_watch():
    """Clears the watcher's data and resets its status. This does not stop the watcher if it is running."""
    global watcher_instance
    if watcher_instance:
        watcher_instance.data = {}
        watcher_instance.status = "Cleared"
    return {"status": "cleared"}, 200

def stream():
    """Streams the watcher's status and data to the client using Server-Sent Events (SSE)."""
    def generate():
        while True:
            if watcher_instance:
                payload = json.dumps({
                    "message": watcher_instance.status,
                    "running": watcher_instance.is_running,
                    "data": watcher_instance.data
                })
                yield f"data: {payload}\n\n"
            time.sleep(1)
    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Accel-Buffering": "no"
        }
    )

def render_public_watch():
    return render_template("netwatch.public.html")

def public_stream():
    """Streams the watcher's status and data to the client using Server-Sent Events (SSE) for public access."""
    return stream()
import json
import time

from flask import Response, jsonify, render_template, request, current_app

from .services import Watcher

watcher_instance = None

def render_netwatch():
    return render_template("netwatch.html")

def start_watch():
    global watcher_instance
    if watcher_instance and watcher_instance.is_running:
        return jsonify({"status": "already_running"})

    payload = request.json or {}
    devices = [d.strip() for d in payload.get("devices", "").split(",") if d.strip()]
    _credentials = {
        "jumphost_ip": "10.122.4.206",
        "jumphost_username": "cmluser",
        "jumphost_password": "cm1user",
        "network_username": "cisco",
        "network_password": "cisco",
    }
    credentials = payload.get("credentials", {}) or _credentials

    watcher_instance = Watcher(devices, credentials)
    watcher_instance.start()
    return jsonify({"status": "started"})

def stop_watch():
    global watcher_instance
    if watcher_instance:
        watcher_instance.stop()
    return jsonify({"status": "stopped"})

def clear_watch():
    global watcher_instance
    if watcher_instance:
        watcher_instance.data = {}
        watcher_instance.status = "Cleared"
    return {"status": "cleared"}, 200

def stream():
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
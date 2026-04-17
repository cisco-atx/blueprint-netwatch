import json
import time

from flask import (
    Response,
    jsonify,
    render_template,
    request,
    session,
    abort
)

# injected from blueprint.py
manager = None


def get_current_user():
    return session.get("username", "anonymous")


def render_home():
    return render_template("netwatch.html")


def render_watcher(watcher_id):
    record = manager.get(watcher_id)
    if not record:
        abort(404)

    can_edit = record["creator"] == get_current_user()

    return render_template(
        "netwatch.detail.html",
        watcher_id=watcher_id,
        watcher_name=record["name"],
        can_edit=can_edit
    )


def create_watch():
    payload = request.json or {}

    name = (payload.get("name") or "").strip()
    devices = [
        d.strip()
        for d in payload.get("devices", "").split(",")
        if d.strip()
    ]
    connector = payload.get("config") or {}

    if not name:
        return jsonify({"status": "error", "message": "Name is required"}), 400

    if not devices:
        return jsonify({"status": "error", "message": "At least one device is required"}), 400

    creator = get_current_user()

    record = manager.create(
        name=name,
        devices=devices,
        connector=connector,
        creator=creator
    )

    return jsonify({
        "status": "created",
        "id": record["id"]
    })


def list_watchers():
    current_user = get_current_user()

    data = []

    for record in manager.list_all():
        watcher = record["watcher"]

        data.append({
            "id": record["id"],
            "name": record["name"],
            "devices": ", ".join(record["devices"]),
            "status": record["status"],
            "creator": record["creator"],
            "can_edit": record["creator"] == current_user,
            "running": watcher.is_running
        })

    return jsonify(data)


def start_watch(watcher_id):
    record = manager.get(watcher_id)

    if not record:
        return jsonify({"status": "not_found"}), 404

    if record["creator"] != get_current_user():
        return jsonify({"status": "forbidden"}), 403

    manager.start(watcher_id)

    return jsonify({"status": "started"})


def stop_watch(watcher_id):
    record = manager.get(watcher_id)

    if not record:
        return jsonify({"status": "not_found"}), 404

    if record["creator"] != get_current_user():
        return jsonify({"status": "forbidden"}), 403

    manager.stop(watcher_id)

    return jsonify({"status": "stopped"})

def delete_watch(watcher_id):
    record = manager.get(watcher_id)

    if not record:
        return jsonify({"status": "not_found"}), 404

    if record["creator"] != get_current_user():
        return jsonify({"status": "forbidden"}), 403

    manager.delete(watcher_id)

    return jsonify({"status": "deleted"})


def stream(watcher_id):
    def generate():
        while True:
            record = manager.get(watcher_id)

            if not record:
                payload = json.dumps({
                    "message": "Watcher not found",
                    "running": False,
                    "data": {}
                })
                yield f"data: {payload}\n\n"
                break

            watcher = record["watcher"]

            payload = json.dumps({
                "message": watcher.status,
                "running": watcher.is_running,
                "data": watcher.data
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

def watchers_stream():
    def generate():
        while True:
            data = []

            for record in manager.list_all():
                watcher = record["watcher"]

                data.append({
                    "id": record["id"],
                    "name": record["name"],
                    "devices": ", ".join(record["devices"]),
                    "status": record["status"],
                    "creator": record["creator"],
                    "running": watcher.is_running
                })

            payload = json.dumps(data)

            yield f"data: {payload}\n\n"

            time.sleep(2)  # adjust frequency

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )

def enable_public(watcher_id):
    record = manager.get(watcher_id)

    if not record:
        return jsonify({"status": "not_found"}), 404

    if record["creator"] != get_current_user():
        return jsonify({"status": "forbidden"}), 403

    result = manager.enable_public(watcher_id, get_current_user())

    return jsonify({
        "status": "enabled",
        "url": f"/netwatch/{watcher_id}/public",
        "pin": result["pin"]
    })

def render_public_watch(watcher_id):
    record = manager.get(watcher_id)

    if not record or not record.get("public_enabled"):
        abort(404)

    return render_template(
        "netwatch.public.html",
        watcher_id=watcher_id,
        watcher_name=record["name"]
    )

def public_stream(watcher_id):
    pin = request.args.get("pin")

    def generate():
        while True:
            record = manager.validate_public(watcher_id, pin)

            if not record:
                yield f"data: {json.dumps({'error': 'unauthorized'})}\n\n"
                break

            watcher = record["watcher"]

            payload = json.dumps({
                "message": watcher.status,
                "running": watcher.is_running,
                "data": watcher.data
            })

            yield f"data: {payload}\n\n"
            time.sleep(1)

    return Response(generate(), mimetype="text/event-stream")
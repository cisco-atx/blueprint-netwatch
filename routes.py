"""Flask routes for Netwatch application.

Handles HTTP endpoints for watcher management, streaming updates,
and public access. Integrates with the watcher manager service
to perform CRUD operations and stream real-time data.

File path: routes.py
"""

import json
import logging
import time

from flask import (
    Response,
    abort,
    jsonify,
    render_template,
    request,
    session,
)

from .services import DIAGNOSTICS

logger = logging.getLogger(__name__)

# Injected from the blueprint
manager = None


def get_current_user():
    """Return the current logged-in user."""
    return session.get("username", "anonymous")


def render_home():
    """Render the home page."""
    return render_template("netwatch.html", DIAGNOSTICS=DIAGNOSTICS)


def render_watcher(watcher_id):
    """Render a specific watcher detail page."""
    record = manager.get(watcher_id)

    if not record:
        logger.warning("Watcher not found: %s", watcher_id)
        abort(404)

    can_edit = record["creator"] == get_current_user()

    return render_template(
        "netwatch.detail.html",
        watcher_id=watcher_id,
        watcher_name=record["id"],
        can_edit=can_edit,
    )


def create_watch():
    """Create a new watcher."""
    payload = request.json or {}
    id = (payload.get("id") or "").strip()
    devices = [
        d.strip()
        for d in payload.get("devices", "").split(",")
        if d.strip()
    ]
    connector = payload.get("config") or {}
    diagnostics = payload.get("diagnostics", {})
    interval = int(connector.get("interval", 10))
    creator = get_current_user()

    record = manager.create(
        id=id,
        devices=devices,
        connector=connector,
        diagnostics=diagnostics,
        interval=interval,
        creator=creator,
    )

    return jsonify({"status": "created", "id": record["id"]})


def list_watchers():
    """List all watchers."""
    current_user = get_current_user()

    data = [
        {
            "id": record["id"],
            "devices": ", ".join(record["devices"]),
            "creator": record["creator"],
            "can_edit": record["creator"] == current_user,
            "status": record["watcher"].status,
        }
        for record in manager.list_all()
    ]

    return jsonify(data)


def start_watch(watcher_id):
    """Start a watcher."""
    logger.info("Starting watcher: %s", watcher_id)
    record = manager.get(watcher_id)

    if not record:
        logger.warning("Watcher not found: %s", watcher_id)
        return jsonify({"status": "not_found"}), 404

    if record["creator"] != get_current_user():
        logger.warning("Unauthorized start attempt for: %s", watcher_id)
        return jsonify({"status": "forbidden"}), 403

    manager.start(watcher_id)
    logger.info("Watcher started: %s", watcher_id)

    return jsonify({"status": "started"})


def stop_watch(watcher_id):
    """Stop a watcher."""
    logger.info("Stopping watcher: %s", watcher_id)
    record = manager.get(watcher_id)

    if not record:
        logger.warning("Watcher not found: %s", watcher_id)
        return jsonify({"status": "not_found"}), 404

    if record["creator"] != get_current_user():
        logger.warning("Unauthorized stop attempt for: %s", watcher_id)
        return jsonify({"status": "forbidden"}), 403

    manager.stop(watcher_id)
    logger.info("Watcher stopped: %s", watcher_id)

    return jsonify({"status": "stopped"})


def delete_watch(watcher_id):
    """Delete a watcher."""
    logger.info("Deleting watcher: %s", watcher_id)
    record = manager.get(watcher_id)

    if not record:
        logger.warning("Watcher not found: %s", watcher_id)
        return jsonify({"status": "not_found"}), 404

    if record["creator"] != get_current_user():
        logger.warning("Unauthorized delete attempt for: %s", watcher_id)
        return jsonify({"status": "forbidden"}), 403

    manager.delete(watcher_id)
    logger.info("Watcher deleted: %s", watcher_id)

    return jsonify({"status": "deleted"})


def stream(watcher_id):
    """Stream watcher data as server-sent events."""

    def generate():
        """Generate SSE stream for watcher data."""
        while True:
            data = manager.get_watcher_data(watcher_id)

            if not data:
                payload = json.dumps(
                    {
                        "log": "Watcher not found",
                        "status": False,
                        "last_updated": None,
                        "data": {},
                    }
                )
                yield f"data: {payload}\n\n"
                break

            yield f"data: {json.dumps(data)}\n\n"
            time.sleep(1)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Accel-Buffering": "no",
        },
    )


def watchers_stream():
    """Stream all watchers data as server-sent events."""

    def generate():
        """Generate SSE stream for all watchers."""
        while True:
            data = [
                {
                    "id": record["id"],
                    "devices": ", ".join(record["devices"]),
                    "status": record["watcher"].status,
                    "creator": record["creator"],
                }
                for record in manager.list_all()
            ]

            yield f"data: {json.dumps(data)}\n\n"
            time.sleep(2)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def enable_public(watcher_id):
    """Enable public access for a watcher."""
    logger.info("Enabling public access for watcher: %s", watcher_id)
    record = manager.get(watcher_id)

    if not record:
        return jsonify({"status": "not_found"}), 404

    if record["creator"] != get_current_user():
        return jsonify({"status": "forbidden"}), 403

    result = manager.enable_public(watcher_id, get_current_user())

    return jsonify(
        {
            "status": "enabled",
            "url": f"/netwatch/{watcher_id}/public",
            "pin": result["pin"],
        }
    )


def render_public_watch(watcher_id):
    """Render public watcher page."""
    record = manager.get(watcher_id)

    if not record or not record.get("public_enabled"):
        logger.warning("Public watcher not accessible: %s", watcher_id)
        abort(404)

    return render_template(
        "netwatch.public.html",
        watcher_id=record["id"],
    )


def public_stream(watcher_id):
    """Stream public watcher data with PIN validation."""
    pin = request.args.get("pin")

    def generate():
        """Generate SSE stream for public watcher."""
        while True:
            record = manager.validate_public(watcher_id, pin)

            if not record:
                yield f"data: {json.dumps({'error': 'unauthorized'})}\n\n"
                break

            data = manager.get_watcher_data(watcher_id)

            if not data:
                payload = json.dumps(
                    {
                        "log": "Watcher not found",
                        "status": False,
                        "last_updated": None,
                        "data": {},
                    }
                )
                yield f"data: {payload}\n\n"
                break

            yield f"data: {json.dumps(data)}\n\n"
            time.sleep(1)

    return Response(generate(), mimetype="text/event-stream")

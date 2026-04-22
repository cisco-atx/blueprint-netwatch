"""
NetWatch blueprint module.

Provides a Flask Blueprint for managing real-time network interface
watchers, including creation, control, and streaming endpoints.
This module wires routes and services together for the NetWatch feature.

File path: blueprint.py
"""

import logging

from flask import Blueprint, current_app

from . import routes, services

logger = logging.getLogger(__name__)

watcher_manager = services.WatcherManager()


class NetWatch(Blueprint):
    """Flask Blueprint for NetWatch functionality."""

    meta = {
        "name": "NetWatch",
        "description": "Real-time network interface watcher",
        "version": "1.0.0",
        "icon": "netwatch.ico",
        "url_prefix": "/netwatch",
    }

    def __init__(self, **kwargs):
        """Initialize the NetWatch blueprint."""

        super().__init__(
            "netwatch",
            __name__,
            url_prefix=self.meta["url_prefix"],
            template_folder="templates",
            static_folder="static",
            **kwargs,
        )

        self.routes = routes
        self.services = services

        self.setup_services()
        self.setup_routes()

    def setup_services(self):
        """Initialize services required by the NetWatch blueprint."""
        try:
            self.routes.manager = watcher_manager
        except Exception:
            logger.exception("Failed to set up services")
            raise

    def setup_routes(self):
        """Define URL routes for the NetWatch blueprint."""

        try:
            self.add_url_rule(
                "/",
                view_func=self.routes.render_home,
                methods=["GET"],
            )
            self.add_url_rule(
                "/create",
                view_func=self.routes.create_watch,
                methods=["POST"],
            )
            self.add_url_rule(
                "/watchers",
                view_func=self.routes.list_watchers,
                methods=["GET"],
            )
            self.add_url_rule(
                "/watchers/stream",
                view_func=self.routes.watchers_stream,
                methods=["GET"],
            )
            self.add_url_rule(
                "/<watcher_id>/start",
                view_func=self.routes.start_watch,
                methods=["POST"],
            )
            self.add_url_rule(
                "/<watcher_id>/stop",
                view_func=self.routes.stop_watch,
                methods=["POST"],
            )
            self.add_url_rule(
                "/<watcher_id>/delete",
                view_func=self.routes.delete_watch,
                methods=["POST"],
            )
            self.add_url_rule(
                "/<watcher_id>",
                view_func=self.routes.render_watcher,
                methods=["GET"],
            )
            self.add_url_rule(
                "/<watcher_id>/stream",
                view_func=self.routes.stream,
                methods=["GET"],
            )
            self.add_url_rule(
                "/<watcher_id>/public/enable",
                view_func=self.routes.enable_public,
                methods=["POST"],
            )

            # Public routes without authentication
            self.add_url_rule(
                "/<watcher_id>/public",
                view_func=current_app.routes.no_auth_required(
                    self.routes.render_public_watch
                ),
                methods=["GET"],
            )
            self.add_url_rule(
                "/<watcher_id>/public/stream",
                view_func=current_app.routes.no_auth_required(
                    self.routes.public_stream
                ),
                methods=["GET"],
            )


        except Exception:
            logger.exception("Failed to register routes")
            raise

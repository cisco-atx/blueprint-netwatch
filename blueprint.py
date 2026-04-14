from flask import Blueprint, current_app

from . import routes, services

class NetWatch(Blueprint):
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
        self.setup_routes()

    def setup_routes(self):
        """Define the URL routes for the NetWatch blueprint."""
        self.add_url_rule("/", view_func=self.routes.render_netwatch, methods=["GET"])
        self.add_url_rule("/start", view_func=self.routes.start_watch, methods=["POST"])
        self.add_url_rule("/stop", view_func=self.routes.stop_watch, methods=["POST"])
        self.add_url_rule("/clear", view_func=self.routes.clear_watch, methods=["POST"])
        self.add_url_rule("/stream",view_func=self.routes.stream)
        self.add_url_rule("/public", view_func=current_app.routes.no_auth_required(self.routes.render_public_watch), methods=["GET", "POST"])
        self.add_url_rule("/public_stream", view_func=current_app.routes.no_auth_required(self.routes.public_stream))
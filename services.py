"""Watcher services module.

Provides watcher management and device data collection services
for network diagnostics. Includes threaded polling, handler
management, and data formatting utilities.

File path: services.py
"""

import logging
import random
import re
import socket
import threading
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

from netcore import GenericHandler

logger = logging.getLogger(__name__)

DIAGNOSTICS = {
    "interface_status": {
        "name": "Interface Status",
        "source": "show interface status",
        "processor": "process_interface_status",
        "diagnostics": {
            "status": {
                "name": "Status",
                "checked": True,
                "format": {
                    "type": "badge",
                    "map": {
                        "connected": {"class": "pass"},
                        "up": {"class": "pass"},
                        "disabled": {"class": "default"},
                        "notconnec": {"class": "warn"},
                        "down": {"class": "fail"},
                    },
                    "default": {"class": "info"},
                },
            },
            "description": {"name": "Description", "checked": True},
            "link": {"name": "Link", "checked": True},
            "duplex": {
                "name": "Duplex",
                "checked": True,
                "format": {
                    "type": "badge",
                    "map": {
                        "full": {"class": "pass"},
                        "half": {"class": "warn"},
                    },
                    "default": {"class": "info"},
                },
            },
            "speed": {"name": "Speed", "checked": True},
            "media_type": {"name": "Media Type", "checked": True},
        },
    },
    "cdp_neighbors": {
        "name": "CDP Neighbors",
        "source": "show cdp neighbors",
        "processor": "process_cdp_neighbors",
        "diagnostics": {
            "neighbor": {"name": "Neighbor", "checked": True},
            "platform": {"name": "Platform", "checked": True},
            "remote_interface": {
                "name": "Remote Interface",
                "checked": True,
            },
            "capabilities": {"name": "Capabilities", "checked": False},
        },
    },
    "mac_addresses": {
        "name": "MAC Addresses",
        "source": "show mac address",
        "processor": "process_mac_addresses",
        "diagnostics": {
            "mac_address": {"name": "MAC Address", "checked": True},
            "vlan": {"name": "VLAN", "checked": True},
            "type": {"name": "Type", "checked": False},
        },
    },
    "arp_table": {
        "name": "ARP Table",
        "source": "show ip arp",
        "processor": "process_arp_table",
        "diagnostics": {
            "ip_address": {
                "name": "IP Address",
                "checked": True,
                "format": {
                    "type": "badge",
                    "map": {"na": {"class": "default"}},
                    "default": {"class": "info"},
                },
            },
            "age": {"name": "Age", "checked": False},
        },
    },
    "dns": {
        "name": "DNS Resolution",
        "source": "socket.getfqdn",
        "processor": "process_dns_resolution",
        "diagnostics": {
            "hostname": {
                "name": "Hostname",
                "checked": True,
                "format": {
                    "type": "badge",
                    "map": {"na": {"class": "default"}},
                    "default": {"class": "pass"},
                },
            }
        },
    },
}


class WatcherManager:
    """Manage lifecycle and access of watcher instances."""

    def __init__(self):
        """Initialize watcher manager."""
        self.watchers = {}

    def create(self, id, devices, connector, interval, diagnostics, creator):
        """Create and register a new watcher."""
        watcher = Watcher(
            devices=devices,
            connector=connector,
            interval=interval,
            diagnostics=diagnostics,
        )

        self.watchers[id] = {
            "id": id,
            "devices": devices,
            "creator": creator,
            "watcher": watcher,
            "created_at": datetime.utcnow(),
        }
        return self.watchers[id]

    def get_watcher_data(self, watcher_id):
        """Retrieve watcher data."""
        record = self.watchers.get(watcher_id)
        if not record:
            return None
        return record["watcher"].get_data()

    def get(self, watcher_id):
        """Get watcher record."""
        return self.watchers.get(watcher_id)

    def list_all(self):
        """List all watchers."""
        return list(self.watchers.values())

    def start(self, watcher_id):
        """Start a watcher."""
        record = self.watchers.get(watcher_id)
        if not record:
            return False

        record["watcher"].start()
        return True

    def stop(self, watcher_id):
        """Stop a watcher."""
        record = self.watchers.get(watcher_id)
        if not record:
            return False

        record["watcher"].stop()
        return True

    def delete(self, watcher_id):
        """Delete a watcher."""
        record = self.watchers.get(watcher_id)
        if not record:
            return False

        record["watcher"].stop()
        del self.watchers[watcher_id]
        return True

    def enable_public(self, watcher_id, creator):
        """Enable public access for watcher."""
        record = self.watchers.get(watcher_id)
        if not record or record["creator"] != creator:
            return None

        pin = str(random.randint(1000, 9999))
        record["public_pin"] = pin
        record["public_enabled"] = True

        return {"watcher_id": watcher_id, "pin": pin}

    def validate_public(self, watcher_id, pin):
        """Validate public access."""
        record = self.watchers.get(watcher_id)

        if not record or not record.get("public_enabled"):
            return None

        if record.get("public_pin") != pin:
            return None

        return record


class Watcher:
    """Watcher responsible for periodic data collection."""

    def __init__(self, devices, connector, interval, diagnostics):
        """Initialize watcher."""
        self.executor = DeviceExecutor(
            self, devices, connector, diagnostics
        )
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = None
        self.lock = threading.RLock()

        self.status = "Not Started"
        self.log = "Watcher initialized."
        self.last_updated = None

    def start(self):
        """Start watcher thread."""
        self.log = "Starting watcher..."
        self.status = "Starting"
        self.stop_event.clear()

        self.executor.create_handlers()

        self.thread = threading.Thread(
            target=self.watch_loop,
            daemon=True,
        )
        self.thread.start()

    def stop(self):
        """Stop watcher thread."""
        self.log = "Stopping watcher..."
        self.status = "Stopping"
        self.stop_event.set()

        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=3)

        self.executor.destroy_handlers()

        self.log = "Watcher stopped."

    def watch_loop(self):
        """Main watcher loop."""
        self.log = "Watcher is running."
        self.status = "Running"

        while not self.stop_event.is_set():
            self.executor.collect()
            self.stop_event.wait(self.interval)

        self.log = "Watcher has stopped."
        self.status = "Stopped"

    def get_data(self):
        """Return collected data."""
        with self.lock:
            return {
                "status": self.status,
                "log": self.log,
                "last_updated": self.last_updated,
                "data": self.executor.data,
            }


class DeviceExecutor:
    """Execute device operations and data collection."""

    def __init__(self, watcher, devices, connector, diagnostics):
        """Initialize executor."""
        self.watcher = watcher
        self.devices = devices or []
        self.connector = connector or {}
        self.diagnostics = diagnostics or {}

        self.handlers = {}
        self.data = {}
        self.lock = threading.RLock()

    def _create_handler(self, device):
        """Create device handler."""
        try:
            handler = GenericHandler(
                hostname=device,
                username=self.connector["network_username"],
                password=self.connector["network_password"],
                proxy={
                    "hostname": self.connector["jumphost_ip"],
                    "username": self.connector["jumphost_username"],
                    "password": self.connector["jumphost_password"],
                },
                handler="NETMIKO",
            )
            logger.info("Connected to %s", device)
            return device, handler
        except Exception as exc:
            self.watcher.log = f"Failed to connect {device}: {exc}"
            logger.exception("Connection failed for %s", device)
            return device, None

    def create_handlers(self):
        """Initialize handlers for all devices."""
        self.watcher.log = "Connecting..."

        with ThreadPoolExecutor(
                max_workers=min(8, len(self.devices))
        ) as executor:
            futures = {
                executor.submit(self._create_handler, d): d
                for d in self.devices
            }

            for future in as_completed(futures):
                device, handler = future.result()
                if handler:
                    with self.lock:
                        self.handlers[device] = handler

    def destroy_handlers(self):
        """Disconnect all handlers."""
        self.watcher.log = "Disconnecting..."

        with self.lock:
            handlers = list(self.handlers.items())
            self.handlers.clear()

        for device, handler in handlers:
            try:
                if hasattr(handler, "disconnect"):
                    handler.disconnect()
                logger.info("Disconnected %s", device)
            except Exception:
                logger.exception("Disconnect failed for %s", device)

    def collect(self):
        """Collect diagnostics data from devices."""
        self.watcher.log = "Polling data..."

        with self.lock:
            handlers = list(self.handlers.items())

        all_devices_data = {}

        for device, handler in handlers:
            try:
                common_data = {}

                ordered = sorted(
                    self.diagnostics.keys(),
                    key=lambda c: DIAGNOSTICS.get(c, {}).get(
                        "order", 999
                    ),
                )

                for category in ordered:
                    processor = DIAGNOSTICS.get(category, {}).get(
                        "processor"
                    )
                    if processor and hasattr(self, processor):
                        getattr(self, processor)(handler, common_data)

                all_devices_data[device] = self._filter(common_data)
                self.watcher.last_updated = datetime.now().strftime(
                    "%d-%b-%Y %H:%M:%S"
                )

            except Exception:
                logger.exception(
                    "Collection failed for %s", device
                )

        self.data = all_devices_data
        return all_devices_data

    def _filter(self, data):
        """Filter and format collected data."""
        result = {}

        for iface, iface_data in data.items():
            result[iface] = {}

            for category, fields in self.diagnostics.items():
                diag_config = DIAGNOSTICS.get(
                    category, {}
                ).get("diagnostics", {})

                for field in fields:
                    if field not in iface_data:
                        continue

                    display_name = diag_config.get(
                        field, {}
                    ).get("name", field)

                    if display_name in result[iface]:
                        display_name = f"{category}.{display_name}"

                    result[iface][display_name] = self._format_value(
                        category, field, iface_data[field]
                    )

        return result

    def _format_value(self, category, key, value):
        """Format field value."""
        config = DIAGNOSTICS.get(category, {}).get(
            "diagnostics", {}
        ).get(key, {})
        fmt = config.get("format")

        if not fmt:
            if isinstance(value, list):
                return "<br>".join(
                    self._format_default(v) for v in value
                )
            return self._format_default(value)

        if fmt.get("type") == "badge":
            if isinstance(value, list):
                return "<br>".join(
                    self._format_badge(fmt, v) for v in value
                )
            return self._format_badge(fmt, value)

        return value

    def _format_default(self, value):
        """Format default value."""
        return f"<span class='badge base nostyle'>{value}</span>"

    def _format_badge(self, fmt, value):
        """Format badge value."""
        if value in (None, ""):
            return ""

        value_str = str(value).strip().lower()
        config = fmt.get("map", {}).get(
            value_str, fmt.get("default", {})
        )

        css_class = config.get("class")
        icon = config.get("icon")

        classes = ["badge", "base"]
        if css_class:
            classes.append(css_class)

        icon_html = (
            f"<span class='material-icons'>{icon}</span>"
            if icon
            else ""
        )

        return (
            f"<span class='{' '.join(classes)}'>"
            f"{icon_html}{value}</span>"
        )

    def normalize_iface(self, iface):
        """Normalize interface name."""
        if not iface:
            return ""

        labels = ["Te", "Gi", "Fa", "Eth", "Lo", "Vl", "Two", "Twe"]

        for label in labels:
            if re.match(f"^{label}", str(iface), re.IGNORECASE):
                port = re.search(r"(\d+\S*)", str(iface))
                return f"{label}{port.group(1)}" if port else iface

        return str(iface)

    def normalize_link(self, link):
        """Normalize link representation."""
        if isinstance(link, int) or (
                isinstance(link, str) and link.isdigit()
        ):
            return f"Access (Vlan{link})"
        return str(link).title() if link else ""

    def process_interface_status(self, handler, data):
        """Process interface status."""
        raw = handler.sendCommand(
            cmd="show interface status",
            autoParse=True,
            key="interface",
        ) or {}

        for iface, props in raw.items():
            iface = self.normalize_iface(iface)
            data.setdefault(iface, {})

            data[iface].update(
                {
                    "status": props.get("status", "").upper(),
                    "link": self.normalize_link(
                        props.get("vlan_id")
                    ),
                    "duplex": props.get("duplex"),
                    "speed": props.get("speed"),
                    "description": props.get("name"),
                    "media_type": props.get("type"),
                }
            )

    def process_cdp_neighbors(self, handler, data):
        """Process CDP neighbors."""
        raw = handler.sendCommand(
            cmd="show cdp neighbors",
            autoParse=True,
            key="local_interface",
        ) or {}

        for iface, props in raw.items():
            iface = self.normalize_iface(iface)

            if iface not in data:
                continue

            data[iface].update(
                {
                    "neighbor": props.get("neighbor"),
                    "platform": props.get("platform"),
                    "capabilities": props.get("capabilities"),
                    "remote_interface": self.normalize_iface(
                        props.get("remote_interface")
                    ),
                }
            )

    def process_mac_addresses(self, handler, data):
        """Process MAC addresses."""
        raw = handler.sendCommand(
            cmd="show mac address",
            autoParse=True,
            key="mac_address",
        ) or {}

        for mac, props in raw.items():
            port = self.normalize_iface(props.get("ports"))

            if port not in data:
                continue

            data[port].setdefault("mac_address", []).append(mac)
            data[port].setdefault("vlan", []).append(
                props.get("vlan_id", "")
            )
            data[port].setdefault("type", []).append(
                props.get("type", "")
            )

    def process_arp_table(self, handler, data):
        """Process ARP table."""
        raw = handler.sendCommand(
            cmd="show ip arp",
            autoParse=True,
            key="mac_address",
        ) or {}

        for iface_data in data.values():
            for mac in iface_data.get("mac_address", []):
                entry = raw.get(mac, {})
                iface_data.setdefault("ip_address", []).append(
                    entry.get("ip_address", "NA")
                )
                iface_data.setdefault("age", []).append(
                    entry.get("age", "NA")
                )

    def process_dns_resolution(self, handler, data):
        """Process DNS resolution."""
        for iface_data in data.values():
            for ip in iface_data.get("ip_address", []):
                if ip == "NA":
                    hostname = "NA"
                else:
                    try:
                        hostname = socket.getfqdn(ip)
                    except Exception:
                        hostname = "NA"

                iface_data.setdefault("hostname", []).append(hostname)

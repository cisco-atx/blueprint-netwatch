import logging
import socket
import threading
import time
import random
import re
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

from netcore import GenericHandler


class WatcherManager:
    """Thread-safe in-memory manager for all user watchers."""

    def __init__(self):
        self.watchers = {}
        self.lock = threading.RLock()

    def create(self, name, devices, connector, creator):
        watcher_id = name

        watcher = Watcher(
            devices=devices,
            connector=connector
        )

        record = {
            "id": watcher_id,
            "name": name,
            "devices": devices,
            "creator": creator,
            "status": "Init",
            "watcher": watcher,
            "created_at": datetime.utcnow()
        }

        with self.lock:
            self.watchers[watcher_id] = record

        return record

    def get(self, watcher_id):
        with self.lock:
            return self.watchers.get(watcher_id)

    def list_all(self):
        with self.lock:
            return list(self.watchers.values())

    def start(self, watcher_id):
        with self.lock:
            record = self.watchers.get(watcher_id)
            if not record:
                return False

            record["watcher"].start()
            record["status"] = "RUNNING"
            return True

    def stop(self, watcher_id):
        with self.lock:
            record = self.watchers.get(watcher_id)
            if not record:
                return False

            record["watcher"].stop()
            record["status"] = "STOPPED"
            return True

    def delete(self, watcher_id):
        with self.lock:
            record = self.watchers.get(watcher_id)
            if not record:
                return False

            try:
                record["watcher"].stop()
            except Exception:
                pass

            del self.watchers[watcher_id]
            return True

    def enable_public(self, watcher_id, creator):
        with self.lock:
            record = self.watchers.get(watcher_id)
            if not record:
                return None

            if record["creator"] != creator:
                return None

            pin = str(random.randint(1000, 9999))

            record["public_pin"] = pin
            record["public_enabled"] = True

            return {
                "watcher_id": watcher_id,
                "pin": pin
            }

    def validate_public(self, watcher_id, pin):
        with self.lock:
            record = self.watchers.get(watcher_id)

            if not record or not record.get("public_enabled"):
                return None

            if record.get("public_pin") != pin:
                return None

            return record


class Watcher:
    """Monitors network devices and collects interface state data."""

    def __init__(self, devices, connector, interval=2):
        self.devices = devices or []
        self.connector = connector or {}
        self.interval = interval

        self.stop_event = threading.Event()

        self.data = {}
        self.thread = None
        self.status = "Init"
        self.is_running = False

        self.handlers = {}
        self.data_lock = threading.RLock()

    def normalize_iface(self, iface):
        if not iface:
            return ""

        labels = ['Te', 'Gi', 'Fa', 'Eth', 'Lo', 'Vl', 'Two', 'Twe']

        for label in labels:
            if re.match(f'^{label}', str(iface), re.IGNORECASE):
                port = re.search(r'(\d+\S*)', str(iface))
                return f"{label}{port.group(1)}" if port else iface

        return str(iface)

    def normalize_link(self, link):
        if isinstance(link, int) or (isinstance(link, str) and link.isdigit()):
            return f"Access (Vlan{link})"

        return str(link).title() if link else ""

    def _build_proxy(self):
        if self.connector.get("jumphost_ip"):
            return {
                "hostname": self.connector["jumphost_ip"],
                "username": self.connector["jumphost_username"],
                "password": self.connector["jumphost_password"],
            }
        return None

    def _create_handler(self, device):
        try:
            handler = GenericHandler(
                hostname=device,
                username=self.connector["network_username"],
                password=self.connector["network_password"],
                proxy=self._build_proxy(),
                handler="NETMIKO",
            )

            logging.info(f"Connected to {device}")
            return device, handler

        except Exception as e:
            logging.error(f"Failed to connect {device}: {e}")
            return device, None

    def create_handlers(self):
        """Create handlers concurrently for all devices."""
        self.status = "Connecting to devices..."

        with ThreadPoolExecutor(max_workers=min(8, max(1, len(self.devices)))) as executor:
            futures = {
                executor.submit(self._create_handler, device): device
                for device in self.devices
            }

            for future in as_completed(futures):
                device, handler = future.result()

                if handler:
                    self.handlers[device] = handler
                    self.status = f"Connected to {device}"

    def destroy_handlers(self):
        """Disconnect and clear all device handlers."""
        self.status = "Disconnecting from devices..."

        for device, handler in list(self.handlers.items()):
            try:
                if hasattr(handler, "disconnect"):
                    handler.disconnect()

                logging.info(f"Disconnected {device}")

            except Exception as e:
                logging.error(f"Disconnect failed for {device}: {e}")

        self.handlers.clear()

    def start(self):
        """Start watcher thread."""
        if self.thread and self.thread.is_alive():
            return

        self.stop_event.clear()

        self.status = "Starting watcher..."
        self.is_running = True

        self.create_handlers()

        self.thread = threading.Thread(
            target=self.watch_loop,
            daemon=True
        )
        self.thread.start()

    def stop(self):
        """Stop watcher thread."""
        self.status = "Stopping watcher..."
        self.is_running = False

        self.stop_event.set()

        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=3)

        self.destroy_handlers()

    def watch_loop(self):
        """Main polling loop."""
        self.status = "Running"

        while not self.stop_event.is_set():
            consolidated = {}

            for device, handler in list(self.handlers.items()):
                try:
                    device_data = self.collect(handler)

                    if device_data:
                        consolidated[device] = device_data

                except Exception as e:
                    logging.error(f"Polling failed for {device}: {e}")

            with self.data_lock:
                self.data = consolidated

            self.stop_event.wait(self.interval)

        self.status = "Stopped"

    def collect(self, handler):
        """Collect interface details from a device."""
        self.status = f"Polling {handler.host}..."

        iface_data = handler.sendCommand(
            cmd="show interface status",
            autoParse=True,
            key="interface"
        ) or {}

        cdp_data = handler.sendCommand(
            cmd="show cdp neighbors",
            autoParse=True,
            key="local_interface"
        ) or {}

        mac_data = handler.sendCommand(
            cmd="show mac address",
            autoParse=True,
            key="mac_address"
        ) or {}

        arp_data = handler.sendCommand(
            cmd="show ip arp",
            autoParse=True,
            key="mac_address"
        ) or {}

        links = {}

        for iface, iface_props in iface_data.items():
            normalized_iface = self.normalize_iface(iface)

            links[normalized_iface] = {
                "Status": iface_props.get("status"),
                "Link": self.normalize_link(
                    iface_props.get("vlan_id")
                ),
                "Duplex": iface_props.get("duplex"),
                "Speed": iface_props.get("speed"),
                "Neighbor": "",
                "Platform": "",
                "Mac Address": [],
                "IP Address": [],
                "Hostname": []
            }

            for cdp_iface, cdp_props in cdp_data.items():
                if self.normalize_iface(cdp_iface) == normalized_iface:
                    links[normalized_iface]["Neighbor"] = cdp_props.get("neighbor")
                    links[normalized_iface]["Platform"] = cdp_props.get("platform")

            for mac, mac_props in mac_data.items():
                port = mac_props.get("ports", "")

                if self.normalize_iface(port) == normalized_iface:
                    links[normalized_iface]["Mac Address"].append(mac)

                    ip = arp_data.get(mac, {}).get("ip_address", "")
                    links[normalized_iface]["IP Address"].append(ip)

                    hostname = ""
                    if ip:
                        try:
                            hostname = socket.getfqdn(ip)
                        except Exception:
                            hostname = ""

                    links[normalized_iface]["Hostname"].append(hostname)

        return links
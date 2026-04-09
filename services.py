import logging
import socket
import threading
import time
import re
from concurrent.futures import ThreadPoolExecutor

from netcore import GenericHandler

class Watcher:
    """Watcher class to monitor network devices and collect interface data."""
    def __init__(self, devices, connector, interval=2):
        self.devices = devices
        self.connector = connector
        self.interval = interval
        self.stop_event = threading.Event()
        self.data = {}
        self.thread = None
        self.status = "Idle"
        self.is_running = False
        self.handlers = {}

    def normalize_iface(self, iface):
        labels = ['Te', 'Gi', 'Fa', 'Eth', 'Lo', 'Vl', 'Two', 'Twe']
        for label in labels:
            if re.match(f'^{label}', iface, re.IGNORECASE):
                port = re.search(r'(\d+\S*)', iface)
                return f"{label}{port.group(1)}" if port else iface
        return iface

    def normalize_link(self, link):
        if isinstance(link, int) or (isinstance(link, str) and link.isdigit()):
            return f"Access (Vlan{link})"
        return link.title()

    def create_handlers(self):
        """Create handlers for each device using a thread pool for concurrent connections."""
        futures = {}
        self.status = "Connecting to devices..."
        with ThreadPoolExecutor(max_workers=8) as executor:
            for device in self.devices:
                future = executor.submit(self._create_handlers)
                futures[future] = device

                for future in futures:
                    device = futures[future]
                    handler = future.result()
                    if handler:
                        self.handlers[device] = handler

    def _create_handlers(self):
        proxy = None
        if self.connector.get("jumphost_ip"):
            proxy = {
                "hostname": self.connector["jumphost_ip"],
                "username": self.connector["jumphost_username"],
                "password": self.connector["jumphost_password"],
            }

        for device in self.devices:
            try:
                handler = GenericHandler(
                    hostname=device,
                    username=self.connector["network_username"],
                    password=self.connector["network_password"],
                    proxy=proxy,
                    handler="NETMIKO",
                )
                self.handlers[device] = handler
                self.status = f"Connected to {device}"
                logging.info(f"Connected to {device}")
            except Exception as e:
                self.status = f"Failed to connect {device}"
                logging.error(f"Failed to connect {device}: {e}")

    def destroy_handlers(self):
        """Disconnect from all devices and clear handlers."""
        self.status = "Disconnecting from devices..."
        for device, handler in list(self.handlers.items()):
            try:
                if hasattr(handler, "disconnect"):
                    handler.disconnect()
                self.status = f"Disconnected {device}"
                logging.info(f"Disconnected {device}")
            except Exception as e:
                logging.error(f"Disconnect failed for {device}: {e}")
        self.handlers.clear()

    def start(self):
        """Start the watcher thread if it's not already running."""
        if not self.thread or not self.thread.is_alive():
            self.status = "Starting watcher..."
            self.stop_event.clear()
            self.is_running = True
            self.create_handlers()
            self.thread = threading.Thread(target=self.watch_loop,daemon=True)
            self.thread.start()

    def stop(self):
        """Stop the watcher thread and disconnect from devices."""
        self.status = "Stopping watcher..."
        self.stop_event.set()
        self.is_running = False
        if self.thread:
            self.thread.join(timeout=2)
        self.destroy_handlers()

    def watch_loop(self):
        """Main loop to poll data from devices at regular intervals until stopped."""
        while not self.stop_event.is_set():
            consolidated = {}
            for device, handler in list(self.handlers.items()):
                device_data = self.collect(handler)
                if device_data:
                    consolidated[device] = device_data
            self.data = consolidated
            self.stop_event.wait(self.interval)

    def collect(self, handler):
        """Collect interface data from a device using the handler. This includes interface status, CDP neighbors, MAC addresses, and ARP entries."""
        self.status = f"Polling data from {handler.host}..."
        iface_data = handler.sendCommand(cmd="show interface status",autoParse=True, key="interface")
        cdp_data = handler.sendCommand(cmd="show cdp neighbors", autoParse=True, key="local_interface")
        mac_data = handler.sendCommand(cmd="show mac address", autoParse=True, key="mac_address")
        arp_data = handler.sendCommand(cmd="show ip arp", autoParse=True, key="mac_address")

        links = {}
        for iface, iface_props in iface_data.items():
            iface = self.normalize_iface(iface)
            links[iface] = {}
            links[iface].update({
                "Status": iface_props.get("status"),
                "Link": self.normalize_link(iface_props.get("vlan_id")),
                "Duplex": iface_props.get("duplex"),
                "Speed": iface_props.get("speed"),
            })
            for cdp_iface, cdp_props in cdp_data.items():
                if self.normalize_iface(cdp_iface) == iface:
                    links[iface].update({
                        "Neighbor": cdp_props.get("neighbor"),
                        "Platform": cdp_props.get("platform")
                    })
            links[iface]["Mac Address"] = []
            links[iface]["IP Address"] = []
            links[iface]["Hostname"] = []
            for mac, mac_props in mac_data.items():
                if self.normalize_iface(mac_props.get("ports", "")) == iface:
                    links[iface]["Mac Address"].append(mac)
                    ip = arp_data.get(mac, {}).get("ip_address", "")
                    links[iface]["IP Address"].append(ip)
                    links[iface]["Hostname"].append(socket.getfqdn(ip) if ip else "")
        return links
const NetwatchAPI = {
    async request(url, method = "POST", body = null) {
        const res = await fetch(url, {
            method,
            headers: body ? { "Content-Type": "application/json" } : {},
            body: body ? JSON.stringify(body) : null
        });

        if (!res.ok) {
            throw new Error(`Request failed: ${url}`);
        }

        return res.json().catch(() => ({}));
    },

    listWatchers() {
        return fetch("/netwatch/watchers").then(r => r.json());
    },

    createWatcher(payload) {
        return this.request("/netwatch/create", "POST", payload);
    },

    start(id) {
        return this.request(`/netwatch/${id}/start`);
    },

    stop(id) {
        return this.request(`/netwatch/${id}/stop`);
    },

    delete(id) {
        return this.request(`/netwatch/${id}/delete`);
    }
};

const NetwatchUI = {
    buttons: {
        start: '<span class="material-icons">play_arrow</span> Start',
        stop: '<span class="material-icons">stop</span> Stop',
        starting: '<span class="material-icons spin">autorenew</span> Starting...',
        stopping: '<span class="material-icons spin">autorenew</span> Stopping...',
        deleting: '<span class="material-icons spin">autorenew</span> Deleting...',
        delete: '<span class="material-icons">delete</span> Delete'
    },

    setLoading(btn, html) {
        if (!btn) return;
        btn.disabled = true;
        btn.innerHTML = html;
    },

    formatStatusBadge(status) {
        const value = (status || "").toUpperCase();

        let cssClass = "status-notrun";

        if (value === "RUNNING") cssClass = "status-pass";
        else if (value === "STOPPED") cssClass = "status-fail";

        return `<span class="badge ${cssClass}">${value}</span>`;
    },

    escapeHtml(value) {
        return $("<div>").text(value || "").html();
    }
};
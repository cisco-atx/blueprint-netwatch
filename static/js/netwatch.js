/* NetWatch - Watchers List Page */

let watchersTable = null;
let createWatcherCallback = null;
let watchersStream = null;

/* =========================
   INIT
========================= */
$(document).ready(function () {
    initTable();
    bindFilters();
    initWatchersStream();
    initCreateWatcherModal();

    $("#createWatcherBtn").on("click", function () {
        openCreateWatcherModal(payload => {
            createWatcher(payload);
        });
    });
});

/* =========================
    SSE STREAM
========================= */

function initWatchersStream() {
    if (watchersStream) return;

    watchersStream = new EventSource("/netwatch/watchers/stream");

    watchersStream.onmessage = (event) => {
        const data = JSON.parse(event.data);
        populateWatchers(data);
    };

    watchersStream.onerror = () => {
        console.warn("Stream lost. Reconnecting...");

        watchersStream.close();
        watchersStream = null;

        setTimeout(initWatchersStream, 2000);
    };
}

/* =========================
   TABLE SETUP
========================= */
function initTable() {
    watchersTable = $("#watchersTable").DataTable({
        orderCellsTop: true,
        fixedHeader: true,
        paging: false,
        searching: true,
        info: false,
        autoWidth: false,
        columns: [
            { title: "Name" },
            { title: "Devices" },
            { title: "Status" },
            { title: "Creator" },
            { title: "Actions", orderable: false }
        ]
    });
}

function bindFilters() {
    $('#watchersTable thead tr:eq(1) th input.col-filter').each(function () {
        const colIndex = $(this).data('col');

        $(this).on('keyup change clear', function () {
            const val = this.value;

            if (watchersTable.column(colIndex).search() !== val) {
                watchersTable.column(colIndex).search(val).draw();
            }
        });
    });
}


/* =========================
   DATA LOADING
========================= */
async function loadWatchers() {
    try {
        const data = await NetwatchAPI.listWatchers();
        populateWatchers(data);
    } catch (err) {
        console.error("Failed to load watchers", err);
    }
}

function populateWatchers(data) {
    watchersTable.clear();

    data.forEach(row => {
        const statusBadge = NetwatchUI.formatStatusBadge(row.status);

        const nameLink = `
            <a class="watcher-link-text" href="/netwatch/${row.id}">
                ${NetwatchUI.escapeHtml(row.name)}
            </a>
        `;
        const actions = (row.creator === CURRENT_USERNAME) ? renderActionButtons(row) : "";

        watchersTable.row.add([
            nameLink,
            NetwatchUI.escapeHtml(row.devices),
            statusBadge,
            NetwatchUI.escapeHtml(row.creator),
            actions
        ]);
    });

    watchersTable.draw(false);
}


/* =========================
   ACTION BUTTONS
========================= */
function renderActionButtons(row) {
    const isRunning = (row.status || "").toUpperCase() === "RUNNING";

    return `
        <div style="display:flex; gap:6px;">
            <button class="icon-text"
                onclick="toggleWatcher('${row.id}', '${row.status}', this)">
                ${isRunning ? NetwatchUI.buttons.stop : NetwatchUI.buttons.start}
            </button>

            <button class="icon-text"
                onclick="openShareModal('${row.id}')">
                <span class="material-icons">share</span> Share
            </button>

            <button class="icon-text"
                onclick="deleteWatcher('${row.id}', this)">
                ${NetwatchUI.buttons.delete}
            </button>
        </div>
    `;
}


async function openShareModal(watcherId) {
    const modal = document.getElementById("shareModal");
    modal.style.display = "flex";

    document.getElementById("generateShareBtn").onclick = async () => {
        const res = await fetch(`/netwatch/${watcherId}/public/enable`, {
            method: "POST"
        });

        const data = await res.json();

        if (data.status !== "enabled") {
            alert("Failed to enable sharing");
            return;
        }

        document.getElementById("shareUrl").value =
            `${window.location.origin}${data.url}`;

        document.getElementById("sharePin").value = data.pin;
    };
}


function closeShareModal() {
    const modal = document.getElementById("shareModal");
    if (modal) {
        modal.style.display = "none";
    }
}

async function toggleWatcher(id, status, btn) {
    const isRunning = (status || "").toUpperCase() === "RUNNING";

    if (isRunning) {
        await stopWatcher(id, btn);
    } else {
        await startWatcher(id, btn);
    }
}

async function startWatcher(id, btn) {
    NetwatchUI.setLoading(btn, NetwatchUI.buttons.starting);

    try {
        await NetwatchAPI.start(id);
    } catch (err) {
        console.error(err);
        alert("Failed to start watcher");
    }
}

async function stopWatcher(id, btn) {
    NetwatchUI.setLoading(btn, NetwatchUI.buttons.stopping);

    try {
        await NetwatchAPI.stop(id);
    } catch (err) {
        console.error(err);
        alert("Failed to stop watcher");
    }
}

async function deleteWatcher(id, btn) {
    if (!confirm("Delete this watcher?")) return;

    NetwatchUI.setLoading(btn, NetwatchUI.buttons.deleting);

    try {
        await NetwatchAPI.delete(id);
    } catch (err) {
        console.error(err);
        alert("Failed to delete watcher");
    }
}


/* =========================
   CREATE WATCHER MODAL
========================= */
function initCreateWatcherModal() {
    const modal = document.getElementById("createWatcherModal");
    const form = document.getElementById("createWatcherForm");
    const connectorSelect = document.getElementById("watcherConnector");

    async function loadConnectors() {
        connectorSelect.innerHTML =
            `<option value="">-- Select Connector --</option>`;

        const res = await fetch("/api/connectors");
        const data = await res.json();

        if (!data.success || !data.connectors) return;

        Object.keys(data.connectors).forEach(name => {
            const option = document.createElement("option");
            option.value = name;
            option.textContent = name;
            connectorSelect.appendChild(option);
        });
    }

    window.openCreateWatcherModal = async function (onConfirm) {
        createWatcherCallback = onConfirm;
        await loadConnectors();
        modal.style.display = "flex";
    };

    function closeModal() {
        modal.style.display = "none";
        form.reset();
    }

    form.addEventListener("submit", async function (e) {
        e.preventDefault();

        const name = $("#watcherName").val().trim();
        const devices = $("#watcherDevices").val().trim();
        const connectorName = connectorSelect.value;

        if (!name) return alert("Watcher name is required");
        if (!devices) return alert("At least one device is required");
        if (!connectorName) return alert("Please select a connector");


        const existingNames = watchersTable.column(0).data().toArray().map(html => {
            const div = document.createElement("div");
            div.innerHTML = html;
            return div.textContent.trim();
        });

        if (existingNames.includes(name)) {
            return alert("Watcher name already exists. Please choose a different name.");
        }

        const res = await fetch("/api/connectors");
        const data = await res.json();
        const config = data.connectors?.[connectorName];

        if (!config) return alert("Connector not found");

        closeModal();

        if (typeof createWatcherCallback === "function") {
            createWatcherCallback({ name, devices, config });
        }
    });

    $("#closeCreateWatcherModal").on("click", closeModal);

    modal.addEventListener("click", function (e) {
        if (e.target === modal) closeModal();
    });
}

async function createWatcher(payload) {
    try {
        const result = await NetwatchAPI.createWatcher(payload);

        if (result.status !== "created") {
            alert(result.message || "Failed to create watcher");
            return;
        }

        await loadWatchers();

    } catch (err) {
        console.error(err);
        alert("Failed to create watcher");
    }
}
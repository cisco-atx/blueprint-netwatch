/**
 * Netwatch.js
 *
 * This file contains the main JavaScript logic for the Netwatch web interface.
 * It handles:
 * - Initializing the watchers table with DataTables
 * - Binding filter inputs for real-time searching
 * - Managing a Server-Sent Events (SSE) stream for live updates of watcher data
 * - Rendering action buttons based on watcher status and user permissions
 * - Implementing the create watcher modal with dynamic connector loading and diagnostic selection
 * - Providing functions to start, stop, delete, and share watchers through API calls
 *
 * The code is structured to ensure a responsive and interactive user experience while managing network watchers.
 */



let watchersTable = null;
let createWatcherCallback = null;
let watchersStream = null;
const watcherUIState = {};

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
        const uiState = watcherUIState[row.id];

        let effectiveStatus = row.status;

        if (uiState === "Starting" && row.status !== "Running") {
            effectiveStatus = "Starting";
        } else if (uiState === "Stopping" && row.status !== "Stopped") {
            effectiveStatus = "Stopping";
        } else {
            watcherUIState[row.id] = null;
        }

        const statusBadge = NetwatchUI.formatStatusBadge(effectiveStatus);

        const nameLink = `
            <a class="watcher-link-text" href="/netwatch/${row.id}">
                ${NetwatchUI.escapeHtml(row.id)}
            </a>
        `;

        const actions = (row.creator === CURRENT_USERNAME)
            ? renderActionButtons(row, effectiveStatus)
            : "";

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
function renderActionButtons(row, effectiveStatus) {
    let buttonHtml = "";

    if (effectiveStatus === "Starting") {
        buttonHtml = NetwatchUI.buttons.starting;
    } else if (effectiveStatus === "Stopping") {
        buttonHtml = NetwatchUI.buttons.stopping;
    } else if (effectiveStatus === "Running") {
        buttonHtml = NetwatchUI.buttons.stop;
    } else {
        buttonHtml = NetwatchUI.buttons.start;
    }

    const disabled =
        effectiveStatus === "Starting" || effectiveStatus === "Stopping";

    return `
        <div style="display:flex; gap:6px;">
            <button class="icon-text"
                ${disabled ? "disabled" : ""}
                onclick="toggleWatcher('${row.id}', '${effectiveStatus}', this)">
                ${buttonHtml}
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
    if (status === "Running") {
        await stopWatcher(id, btn);
    } else {
        await startWatcher(id, btn);
    }
}

async function startWatcher(id, btn) {
    watcherUIState[id] = "Starting";

    NetwatchUI.setLoading(btn, NetwatchUI.buttons.starting);

    try {
        await NetwatchAPI.start(id);
    } catch (err) {
        console.error(err);
        alert("Failed to start watcher");

        watcherUIState[id] = null;
    }
}

async function stopWatcher(id, btn) {
    watcherUIState[id] = "Stopping";

    NetwatchUI.setLoading(btn, NetwatchUI.buttons.stopping);

    try {
        await NetwatchAPI.stop(id);
    } catch (err) {
        console.error(err);
        alert("Failed to stop watcher");

        watcherUIState[id] = null;
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
        setTimeout(() => {
            updateSelectedList();
            syncAllCategoryCheckboxes();
        }, 0);
    };

    function closeModal() {
        modal.style.display = "none";
        form.reset();
    }

    form.addEventListener("submit", async function (e) {
        e.preventDefault();

        const name = $("#watcherName").val().trim();
        const devices = $("#watcherDevices").val().trim();
        const interval = $("#watcherInterval").val().trim() || "10";
        const connectorName = connectorSelect.value;
        const diagnostics = getSelectedDiagnostics();

        if (!name) return alert("Watcher name is required");
        if (!devices) return alert("At least one device is required");
        if (!interval || isNaN(interval) || parseInt(interval) <= 0) {
            return alert("Interval must be a positive number");
        }
        if (!connectorName) return alert("Please select a connector");
        if (Object.keys(diagnostics).length === 0) return alert("Please select at least one diagnostic");

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
            createWatcherCallback({ id:name, devices, config, diagnostics, interval});
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

function updateSelectedList() {
    const list = document.getElementById("selectedDiagnosticsList");
    list.innerHTML = "";

    document.querySelectorAll(".diag-checkbox:checked").forEach(cb => {
        const item = document.createElement("div");
        item.textContent = cb.parentElement.textContent.trim();
        item.classList.add("selected-item");
        item.dataset.value = cb.value;
        list.appendChild(item);
    });
}

function syncAllCategoryCheckboxes() {
    document.querySelectorAll(".category-checkbox").forEach(catCb => {
        const category = catCb.dataset.category;

        const all = document.querySelectorAll(`.diag-checkbox[data-category="${category}"]`);
        const checked = document.querySelectorAll(`.diag-checkbox[data-category="${category}"]:checked`);

        catCb.checked = all.length > 0 && all.length === checked.length;
    });
}

function getSelectedDiagnostics() {
    const result = {};
    document.querySelectorAll(".diag-checkbox:checked").forEach(cb => {
        const [category, diag] = cb.value.split(".");
        if (!result[category]) {
            result[category] = [];
        }
        result[category].push(diag);
    });

    return result;
}

// Individual checkbox change
document.addEventListener("change", function (e) {
    if (e.target.classList.contains("diag-checkbox")) {
        updateSelectedList();

        // update category checkbox state
        const category = e.target.dataset.category;
        const all = document.querySelectorAll(`.diag-checkbox[data-category="${category}"]`);
        const checked = document.querySelectorAll(`.diag-checkbox[data-category="${category}"]:checked`);

        const categoryCheckbox = document.querySelector(`.category-checkbox[data-category="${category}"]`);
        categoryCheckbox.checked = all.length === checked.length;
    }
});

// Category checkbox change
document.addEventListener("change", function (e) {
    if (e.target.classList.contains("category-checkbox")) {
        const category = e.target.dataset.category;
        const checked = e.target.checked;

        document.querySelectorAll(`.diag-checkbox[data-category="${category}"]`)
            .forEach(cb => cb.checked = checked);

        updateSelectedList();
    }
});
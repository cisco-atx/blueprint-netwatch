/* NetWatch - Watcher Detail Page */

let table = null;
let watcherEventStream = null;
let isRunning = false;
let currentColumns = [];

/* =========================
   INIT
========================= */
$(document).ready(function () {
    initStream();
});


/* =========================
   SSE STREAM
========================= */
function initStream() {
    if (watcherEventStream) return;

    watcherEventStream = new EventSource(
        `/netwatch/${window.WATCHER_ID}/stream`
    );

    watcherEventStream.onmessage = handleStreamUpdate;

    watcherEventStream.onerror = () => {
        console.warn("Stream disconnected");
    };
}

function handleStreamUpdate(event) {
    const payload = JSON.parse(event.data);
    const dataset = payload.data || {};

    updateHeader(payload);
    updateStatus(payload);

    if (Object.keys(dataset).length === 0) {
        clearTable();
        return;
    }

    updateTable(dataset);
}


/* =========================
   HEADER / STATUS
========================= */
function updateHeader(payload) {
    $("#statusText").text(payload.message || "Loading...");
}

function updateStatus(payload) {
    const running = payload.running || false;

    setRunningState(running);
    updateStatusBadge(payload.status || (running ? "running" : "stopped"));
}

function setRunningState(running) {
    isRunning = running;

    const btn = $("#toggleBtn");
    if (!btn.length) return; // no permission (can_edit = false)

    btn.html(
        running
            ? NetwatchUI.buttons.stop
            : NetwatchUI.buttons.start
    );
}

function updateStatusBadge(status) {
    const value = (status || "init").toUpperCase();

    let cssClass = "status-info";

    if (value === "RUNNING") cssClass = "status-pass";
    else if (value === "STOPPED") cssClass = "status-fail";

    $("#statusBadge")
        .removeClass("status-pass status-fail status-info")
        .addClass(cssClass)
        .text(value);
}


/* =========================
   TABLE MANAGEMENT
========================= */
function updateTable(dataset) {
    const columns = getDynamicColumns(dataset);

    if (columnsChanged(columns)) {
        rebuildTable(columns);
        currentColumns = columns;
    }

    populateRows(dataset, columns);
}

function clearTable() {
    if (table) {
        table.clear().draw(false);
    }
}

function columnsChanged(newCols) {
    return JSON.stringify(newCols) !== JSON.stringify(currentColumns);
}

function getDynamicColumns(dataset) {
    const base = ["Device", "Interface"];
    const dynamic = new Set();

    Object.values(dataset).forEach(interfaces => {
        Object.values(interfaces).forEach(row => {
            Object.keys(row).forEach(k => dynamic.add(k));
        });
    });

    return [...base, ...Array.from(dynamic)];
}

function rebuildTable(columns) {
    if ($.fn.DataTable.isDataTable("#watchTable")) {
        table.destroy();
    }

    const thead = `
        <tr>
            ${columns.map(col => `<th>${col}</th>`).join("")}
        </tr>
        <tr>
            ${columns.map((_, i) =>
                `<th><input type="text" class="col-filter" data-col="${i}" placeholder="Filter"></th>`
            ).join("")}
        </tr>
    `;

    $("#watchTable thead").html(thead);
    $("#watchTable tbody").empty();

    initTable();
    bindFilters();
}

function initTable() {
    table = $('#watchTable').DataTable({
        orderCellsTop: true,
        fixedHeader: true,
        paging: false,
        searching: true,
        info: false,
        autoWidth: false
    });
}

function bindFilters() {
    $('#watchTable thead tr:eq(1) th input.col-filter').each(function () {
        const colIndex = $(this).data('col');

        $(this).on('keyup change clear', function () {
            const val = this.value;

            if (table.column(colIndex).search() !== val) {
                table.column(colIndex).search(val).draw();
            }
        });
    });
}

function populateRows(dataset, columns) {
    if (!table) return;

    table.clear();

    Object.entries(dataset).forEach(([device, interfaces]) => {
        Object.entries(interfaces).forEach(([iface, row]) => {

            const rowData = columns.map(col => {
                if (col === "Device") return device;
                if (col === "Interface") return iface;

                const value = row[col];

                if (Array.isArray(value)) {
                    return value.join("<br>");
                }

                if (col === "Status") {
                    return formatInterfaceStatus(value);
                }

                return value || "";
            });

            table.row.add(rowData);
        });
    });

    table.draw(false);
}

function formatInterfaceStatus(status) {
    const value = (status || "").toLowerCase();

    let cssClass = "status-info";
    let label = status || "UNKNOWN";

    if (value === "connected") cssClass = "status-pass";
    else if (value === "notconnec") cssClass = "status-warn";
    else if (value === "disabled") cssClass = "status-notrun";

    return `<span class="badge ${cssClass}">${label.toUpperCase()}</span>`;
}


/* =========================
   ACTION BUTTON
========================= */
function toggleWatch() {
    if (isRunning) {
        stopWatch();
    } else {
        startWatch();
    }
}

async function startWatch() {
    const btn = $("#toggleBtn");

    NetwatchUI.setLoading(btn[0], NetwatchUI.buttons.starting);

    try {
        await NetwatchAPI.start(window.WATCHER_ID);
    } catch (err) {
        console.error(err);
        alert("Failed to start watcher");
    } finally {
        btn.prop("disabled", false);
    }
}

async function stopWatch() {
    const btn = $("#toggleBtn");

    NetwatchUI.setLoading(btn[0], NetwatchUI.buttons.stopping);

    try {
        await NetwatchAPI.stop(window.WATCHER_ID);
    } catch (err) {
        console.error(err);
        alert("Failed to stop watcher");
    } finally {
        btn.prop("disabled", false);
    }
}
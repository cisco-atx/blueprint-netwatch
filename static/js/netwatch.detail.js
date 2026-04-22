/* NetWatch - Watcher Detail Page */

let table = null;
let watcherEventStream = null;
let watcherStatus = '';
let currentColumns = [];

/* =========================
   INIT
========================= */
$(document).ready(function () {
    showEmptyState();
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
    const status = payload.status || "INIT";

    updateStatus(payload);
    updateTableState(status, dataset);
}


/* =========================
   HEADER / STATUS
========================= */
function updateHeader(payload) {
    $("#statusText").text(payload.log || "Loading...");
}

function updateStatus(payload) {
    const incoming = payload.status;

    // Allow only valid transitions
    if (watcherStatus === "Starting" && incoming !== "Running") return;
    if (watcherStatus === "Stopping" && incoming !== "Stopped") return;


    $("#statusText").text(payload.log || "Loading...");
    $("#lastUpdated").text("Last Updated: " + (payload.last_updated|| "Never"));
    setRunningState(incoming);
    updateStatusBadge(incoming);
}

function setRunningState(status) {
    watcherStatus = status;

    const btn = $("#toggleBtn");
    if (!btn.length) return;

    btn.prop("disabled", false);

    if (status === "Running") {
        btn.html(NetwatchUI.buttons.stop);
    } else if (status === "Stopped") {
        btn.html(NetwatchUI.buttons.start);
    }
}

function updateStatusBadge(status) {
    const value = status || "Not Started";

    let cssClass = "info";

    if (value === "Running") cssClass = "pass";
    else if (value === "Stopped") cssClass = "fail";
    else if (value === "Starting") cssClass = "info";
    else if (value === "Stopping") cssClass = "info";

    $("#statusBadge")
        .removeClass("pass fail info")
        .addClass(cssClass)
        .text(value.toUpperCase());
}


function updateTableState(status, dataset) {
    if (status === "Starting") {
        showLoadingState("Starting watcher...");
        return;
    }

    if (status === "Running") {
        if (Object.keys(dataset).length === 0) {
            showLoadingState("Waiting for data...");
            return;
        }

        showTable();
        updateTable(dataset);
        return;
    }

    if (status === "Stopped" || status === "Init") {
        showEmptyState("Watcher is stopped");
        $("#lastUpdated").text("Last Updated: N/A");
        clearTable();
        return;
    }
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
                `<th><input type="text" class="col-filter" data-col="${i}" placeholder="Filter.."></th>`
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

            try {
                table
                    .column(colIndex)
                    .search(val, true, false, true)
                    .draw();
            } catch (e) {
                console.warn("Invalid regex:", val);
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

                return  row[col] || "";
            });

            table.row.add(rowData);
        });
    });

    table.draw(false);
}

/* =========================
   ACTION BUTTON
========================= */
function toggleWatch() {
    if (watcherStatus === "Running") {
        stopWatch();
    } else {
        startWatch();
    }
}

async function startWatch() {
    const btn = $("#toggleBtn");

    watcherStatus = "Starting";
    showLoadingState("Starting watcher...");

    NetwatchUI.setLoading(btn[0], NetwatchUI.buttons.starting);
    updateStatusBadge("Starting");
    $("#statusText").text("Starting watcher...");

    try {
        await NetwatchAPI.start(window.WATCHER_ID);
    } catch (err) {
        console.error(err);
        alert("Failed to start watcher");

        watcherStatus = "Stopped";
        setRunningState("Stopped");
        updateStatusBadge("Stopped");
    }
}

async function stopWatch() {
    const btn = $("#toggleBtn");

    watcherStatus = "Stopping";

    NetwatchUI.setLoading(btn[0], NetwatchUI.buttons.stopping);
    updateStatusBadge("Stopping");
    $("#statusText").text("Stopping watcher...");

    try {
        await NetwatchAPI.stop(window.WATCHER_ID);
    } catch (err) {
        console.error(err);
        alert("Failed to stop watcher");

        watcherStatus = "Running";
        setRunningState("Running");
        updateStatusBadge("Running");
    }
}

function showEmptyState(message = "No data yet") {
    $("#tableEmptyState").show().find("div").text(message);
    $("#tableLoadingState").hide();
    $("#watchTable").hide();
}

function showLoadingState(message = "Loading...") {
    $("#tableEmptyState").hide();
    $("#tableLoadingState").show().find("div").text(message);
    $("#watchTable").hide();
}

function showTable() {
    $("#tableEmptyState").hide();
    $("#tableLoadingState").hide();
    $("#watchTable").show();
}
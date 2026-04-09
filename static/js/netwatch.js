/* NetWatch
    * A dynamic interface for monitoring network devices and interfaces in real-time.
    * Features:
        - Real-time updates via Server-Sent Events (SSE)
        - Dynamic table generation based on incoming data structure
        - Column-based filtering for easy data exploration
        - Status badges with color coding for quick visual identification
        - Start, Stop, and Clear controls for managing the monitoring process
*/

let table;
let watcherEventStream;
let isRunning = false;
let currentColumns = [];

const BUTTONS = {
    start: {
        idle: '<span class="material-icons">play_arrow</span> Start',
        running: '<span class="material-icons spin">autorenew</span> Running...',
        stopping: '<span class="material-icons spin">sync</span> Stopping...'
    },
    clear: {
        default: '<span class="material-icons">clear_all</span> Clear',
        cleared: '<span class="material-icons">delete_sweep</span> Cleared'
    }
};

$(document).ready(function () {
    initStream();
    document.getElementById("startBtn").addEventListener("click", () => {
        RunModal.open(({ config }) => {
            startWatch(config);
        });
    });
});

/*
 * Initializes the DataTable with basic configuration.
 * This is called once on page load and whenever the table structure changes.
 */
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

/*
 * Binds event listeners to the filter inputs in the table header.
 * This allows for real-time filtering of the table based on user input.
 */
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

/*
 * Initializes the EventSource to listen for updates from the server.
 * When a message is received, it calls updateUi to refresh the table and status.
 */
function initStream() {
    if (!watcherEventStream) {
        watcherEventStream = new EventSource("/netwatch/stream");
        watcherEventStream.onmessage = updateUi;
        watcherEventStream.onerror = () => console.warn("Stream disconnected");
    }
}

/*
 * Extracts dynamic column names from the dataset.
 * It starts with fixed columns "Device" and "Interface" and adds any unique keys found in the data.
 */
function getDynamicColumns(dataset) {
    const columns = ["Device", "Interface"];
    const dynamicKeys = new Set();

    Object.values(dataset).forEach(interfaces => {
        Object.values(interfaces).forEach(row => {
            Object.keys(row).forEach(key => dynamicKeys.add(key));
        });
    });

    return [...columns, ...Array.from(dynamicKeys)];
}

/*
 * Updates the UI based on the incoming data from the EventSource.
 * It updates the status text, running state, and rebuilds the table if new columns are detected.
 */
function updateUi(event) {
    const payload = JSON.parse(event.data);
    const dataset = payload.data || {};

    $("#statusText").text(payload.message || "Idle");
    setRunningState(payload.running || false);

    if (Object.keys(dataset).length === 0) {
        return;
    }

    const discoveredColumns = getDynamicColumns(dataset);

    if (JSON.stringify(discoveredColumns) !== JSON.stringify(currentColumns)) {
        rebuildTable(discoveredColumns);
        currentColumns = discoveredColumns;
    }

    populateRows(dataset, discoveredColumns);
}

/*
 * Rebuilds the DataTable with the specified columns.
 * It destroys the existing table instance if it exists, updates the table header, and initializes a new DataTable.
 */
function rebuildTable(columns) {
    if ($.fn.DataTable.isDataTable("#watchTable")) {
        table.destroy();
    }

    const thead = `
        <tr>
            ${columns.map(col => `<th>${col}</th>`).join("")}
        </tr>
        <tr>
            ${columns.map((_, idx) =>
                `<th><input type="text" class="col-filter" data-col="${idx}" placeholder="Filter"></th>`
            ).join("")}
        </tr>
    `;

    $("#watchTable thead").html(thead);
    $("#watchTable tbody").empty();

    table = $("#watchTable").DataTable({
        orderCellsTop: true,
        fixedHeader: true,
        paging: false,
        searching: true,
        info: false,
        autoWidth: false
    });

    bindFilters();
}

/*
 * Populates the DataTable with rows based on the provided dataset and column configuration.
 * It formats values appropriately, including handling arrays and status badges.
 */
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
                    return formatStatusBadge(value);
                }

                return value || "";
            });

            table.row.add(rowData);
        });
    });

    table.draw(false);
}

/*
 * Formats the status value into a styled badge.
 * It assigns different CSS classes based on the status value for visual distinction.
 */
function formatStatusBadge(status) {
    const value = (status || '').toLowerCase();

    let cssClass = 'status-info';
    let label = status || 'UNKNOWN';
    if (value === 'connected') {
        cssClass = 'status-pass';
    } else if (value === 'notconnec') {
        cssClass = 'status-warn';
    } else if (value === 'disabled') {
        cssClass = 'status-notrun';
    }
    return `<span class="badge ${cssClass}">${label.toUpperCase()}</span>`;
}


/* Updates the state of the Start and Stop buttons based on whether NetWatch is running.
 * When running, the Start button is disabled and shows a "Running..." state, while the Stop button is enabled.
 * When not running, the Start button is enabled and shows "Start", while the Stop button is disabled.
 */
function setRunningState(running) {
    isRunning = running;
    $("#startBtn")
        .prop("disabled", running)
        .html(running ? BUTTONS.start.running : BUTTONS.start.idle);
    $("#stopBtn")
        .prop("disabled", !running);
}

/* Updates the Clear button's state and label based on whether the data has been cleared.
 * When cleared, the button shows a "Cleared" state; otherwise, it shows the default "Clear" label.
 */
function setClearState(cleared = false) {
    $("#clearBtn").html(
        cleared ? BUTTONS.clear.cleared : BUTTONS.clear.default
    );
}


/* Starts the NetWatch process by sending a POST request to the server with the selected devices and configuration.
 * It also initializes the EventSource stream if it hasn't been initialized yet and updates the UI state to reflect that NetWatch is running.
 */
async function startWatch(config) {
    const devices = $("#devices").val();
    if (!devices || devices.length === 0) {
        alert("Please enter at least one device.");
        return;
    }
    if (!watcherEventStream) {
        initStream();
    }
    setRunningState(true);
    setClearState(false);

    fetch("/netwatch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            devices,
            config: config
        })
    }).catch(() => {
        setRunningState(false);
        alert("Failed to start NetWatch");
    });
}

/*
* Stops the NetWatch process by sending a POST request to the server.
* It updates the UI state to reflect that NetWatch is stopping and disables the Start button while the stop request is in progress.
* Once the request is complete, it resets the Stop button label and updates the running state to false.
*/
function stopWatch() {
    const stopBtn = $("#stopBtn");
    const startBtn = $("#startBtn");
    stopBtn.prop("disabled", true).html(BUTTONS.start.stopping);
    startBtn.prop("disabled", true);
    fetch("/netwatch/stop", {
        method: "POST"
    })
    .finally(() => {
        stopBtn.html('<span class="material-icons">stop</span> Stop');
        setRunningState(false);
    });
}

/* Clears the NetWatch data by sending a POST request to the server.
 * It checks if NetWatch is currently running and prompts the user to stop it before clearing.
 * Once the clear request is complete, it closes the EventSource stream, clears the DataTable, updates the status text, and sets the Clear button state to "Cleared".
 */
function clearWatch() {
    if (isRunning) {
        alert("Please stop NetWatch before clearing.");
        return;
    }
    fetch("/netwatch/clear", {
        method: "POST"
    })
    .finally(() => {
        if (watcherEventStream) {
            watcherEventStream.close();
            watcherEventStream = null;
        }
        table.clear().draw(false);
        $("#statusText").text("Cleared");
        setClearState(true);
    });
}
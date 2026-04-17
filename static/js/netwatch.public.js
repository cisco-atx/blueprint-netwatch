
let table;
let watcherEventStream;
let isRunning = false;
let currentColumns = [];

$(document).ready(function () {
    $("#pinInput").on("keypress", function (e) {
        if (e.which === 13) {
            submitPin();
        }
    });

    $("#pinInput").focus();
});

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
        watcherEventStream = new EventSource("/netwatch/public_stream");
        watcherEventStream.onmessage = updateUi;
        watcherEventStream.onerror = () => console.warn("Stream disconnected");
    }
}

function submitPin() {
    const pin = $("#pinInput").val().trim();

    if (!pin || pin.length !== 4) {
        alert("Enter valid 4-digit PIN");
        return;
    }

    connectStream(pin);
}

function connectStream(pin) {
    if (watcherEventStream) {
        watcherEventStream.close();
    }

    $("#statusText").text("Connecting...");

    watcherEventStream = new EventSource(
        `/netwatch/${WATCHER_ID}/public/stream?pin=${pin}`
    );

    watcherEventStream.onmessage = (event) => {
        const payload = JSON.parse(event.data);

        if (payload.error) {
            alert("Invalid PIN or access denied");
            watcherEventStream.close();
            return;
        }

        $("#pinModal").hide();

        updateUi(event);
    };

    watcherEventStream.onerror = () => {
        console.warn("Stream lost. Reconnecting...");

        watcherEventStream.close();

        setTimeout(() => {
            connectStream(pin);
        }, 2000);
    };
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

    if (payload.error) {
        alert("Invalid PIN or access denied");
        watcherEventStream.close();
        return;
    }

    const dataset = payload.data || {};
    const running = payload.running || false;

    $("#statusText").text(payload.message || "Idle");
    updateStatusBadge(payload.status || (running ? "running" : "stopped"));

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
        info: true,
        autoWidth: false
    });

    bindFilters();
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
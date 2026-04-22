let table;
let watcherEventStream;
let isRunning = false;
let currentColumns = [];
let currentStatus = "Not Started";

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
    const incomingStatus = payload.status;

    if (shouldIgnoreTransition(currentStatus, incomingStatus)) {
        return;
    }

    currentStatus = incomingStatus || currentStatus;

    $("#statusText").text(payload.log || "Idle");
    updateStatusBadge(currentStatus);

    updateTableState(currentStatus, dataset);
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

        const discoveredColumns = getDynamicColumns(dataset);

        if (JSON.stringify(discoveredColumns) !== JSON.stringify(currentColumns)) {
            rebuildTable(discoveredColumns);
            currentColumns = discoveredColumns;
        }

        showTable();
        populateRows(dataset, discoveredColumns);
        return;
    }

    if (status === "Stopped" || status === "Init") {
        showEmptyState("Watcher is stopped");
        if (table) {
            table.clear().draw(false);
        }
        return;
    }
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


function shouldIgnoreTransition(current, incoming) {
    if (!incoming) return true;

    if (current === "Starting" && incoming !== "Running") return true;
    if (current === "Stopping" && incoming !== "Stopped") return true;

    return false;
}

function updateStatusBadge(status) {
    const value = (status || "Init").toUpperCase();

    let cssClass = "info";

    if (value === "RUNNING") cssClass = "pass";
    else if (value === "STOPPED") cssClass = "fail";
    else if (value === "STARTING") cssClass = "info";
    else if (value === "STOPPING") cssClass = "info";

    $("#statusBadge")
        .removeClass("pass fail info")
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

                return value || "";
            });

            table.row.add(rowData);
        });
    });

    table.draw(false);
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

    if (table) {
        setTimeout(() => {
            table.columns.adjust().draw(false);
        }, 0);
    }
}
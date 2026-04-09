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

function initStream() {
    if (!watcherEventStream) {
        watcherEventStream = new EventSource("/netwatch/stream");
        watcherEventStream.onmessage = updateUi;
        watcherEventStream.onerror = () => console.warn("Stream disconnected");
    }
}

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


function setRunningState(running) {
    isRunning = running;
    $("#startBtn")
        .prop("disabled", running)
        .html(running ? BUTTONS.start.running : BUTTONS.start.idle);
    $("#stopBtn")
        .prop("disabled", !running);
}

function setClearState(cleared = false) {
    $("#clearBtn").html(
        cleared ? BUTTONS.clear.cleared : BUTTONS.clear.default
    );
}


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
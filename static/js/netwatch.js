let table;
let watcherEventStream;
let isRunning = false;

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
    initTable();
    bindFilters();
    initStream();
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

function updateUi(event) {
    const payload = JSON.parse(event.data);

    table.clear();

    Object.entries(payload.data || {}).forEach(([device, interfaces]) => {
        Object.entries(interfaces).forEach(([iface, row]) => {
            table.row.add([
                device,
                iface,
                formatStatusBadge(row.Status),
                row.Neighbor || ''
            ]);
        });
    });

    table.draw(false);

    $("#statusText").text(payload.message || "Idle");
    setRunningState(payload.running || false);
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

function startWatch() {
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
            credentials: {}
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
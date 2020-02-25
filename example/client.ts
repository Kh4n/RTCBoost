import RTCBooster from "../rtcbooster"

// the booster to use (1 booster per file currently)
var booster: RTCBooster = null
var downloadButton: HTMLButtonElement = null
window.addEventListener("load", function(_evt) {
    let connectButton = document.getElementById("connect") as HTMLButtonElement
    connectButton.onclick = connect

    downloadButton = document.getElementById("download") as HTMLButtonElement
    downloadButton.onclick = startDownload
})

function connect() {
    let signalAddr = "ws://" + (document.getElementById("signalAddr") as HTMLInputElement).value
    booster = new RTCBooster(signalAddr, "bigfile.txt", 1000000, 10)
    booster.onfilecomplete = function(file: File) {
        console.log(file)
        let r = new FileReader()
        r.onload = function(ev: ProgressEvent<FileReader>) {
            console.log(ev.target.result)
        }
        console.log("File contents:")
        r.readAsText(file)
    }
    booster.onpiece = function(pieceNum: number, _, fromServer: boolean) {
        console.log("Downloaded piece " + pieceNum);
        let d = document.getElementById("" + pieceNum) as HTMLDivElement
        if (fromServer) {
            d.style.backgroundColor = "red"
        } else {
            d.style.backgroundColor = "green"
        }
    }
    booster.onsignalserverconnect = function() {
        // it is clients job to not call RTCBooster.download until the booster is ready
        downloadButton.disabled = false
    }
}

// simulating a video download: we request the CDN as slowly as possible, while the booster aggressively downloads
function startDownload() {
    for (var i = 0; i < 10; i++) {
        let curi = i
        setTimeout(function() {
            booster.download("/bigfile?part=" + curi, curi)
        }, i*1000)
    }
}
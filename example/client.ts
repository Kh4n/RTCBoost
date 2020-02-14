import { RTCBooster } from "../rtcbooster"

var booster: RTCBooster = null
window.addEventListener("load", function(_evt) {
    booster = new RTCBooster("ws://localhost:6503")
    let downloadButton = document.getElementById("download") as HTMLButtonElement
    downloadButton.onclick = startDownload

    let updateButton = document.getElementById("update") as HTMLButtonElement
    updateButton.onclick = update
})

function update() {
    let pieces = booster.files.get("bigfile.txt").data
    for (let key of pieces.keys()) {
        let d = document.getElementById("" + key) as HTMLDivElement
        d.style.backgroundColor = "green"
    }
}

function startDownload() {
    for (var i = 0; i < 10; i++) {
        let curi = i
        setTimeout(function() {
            booster.download("bigfile.txt", "http://localhost:8080/bigfile?part=" + curi, curi)
        }, i*1000)
    }
}
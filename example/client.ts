import { RTCBooster } from "../rtcbooster"

var booster: RTCBooster = null
window.addEventListener("load", function(_evt) {
    booster = new RTCBooster("ws://localhost:6503", "bigfile.txt", 1000000, 10)
    booster.onpiece = function(pieceNum: number, _) {
        console.log("Downloaded piece " + pieceNum);
        let d = document.getElementById("" + pieceNum) as HTMLDivElement
        d.style.backgroundColor = "green"
    }
    let downloadButton = document.getElementById("download") as HTMLButtonElement
    downloadButton.onclick = startDownload
})

function startDownload() {
    for (var i = 0; i < 10; i++) {
        let curi = i
        setTimeout(function() {
            booster.download("http://localhost:8080/bigfile?part=" + curi, curi)
        }, i*1000)
    }
}
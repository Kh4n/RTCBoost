import { RTCBooster } from "../rtcbooster"

var booster: RTCBooster = null
window.addEventListener("load", function(_evt) {
    booster = new RTCBooster("ws://localhost:6503")
    setTimeout(function() {
        startDownload()
    }, 1000)
})

function startDownload() {
    let addrs = []
    for (var i = 0; i < 10; i++) {
        let curi = i
        setTimeout(function() {
            booster.download("bigfile.txt", "http://localhost:8080/bigfile?part=" + curi, curi)
        }, i*1000)
    }
}
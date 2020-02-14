import { RTCBooster } from "../rtcbooster"

var booster: RTCBooster = null
window.addEventListener("load", function(_evt) {
    booster = new RTCBooster("ws://localhost:6503")
    let addrs = []
    for (var i = 0; i < 10; i++) {
        addrs.push("http://localhost:8080/bigfile?part=" + i)
    }
    setTimeout(function() {
        booster.download("bigfile.txt", addrs)
    }, 1000)
})
interface peerConn {
    p: RTCPeerConnection
    in: RTCDataChannel
    out: RTCDataChannel
}

class RTCBooster {
    peerConns: Array<peerConn>
    signalingServer: WebSocket

    constructor(signalAddr: string) {
        this.signalingServer = new WebSocket(signalAddr)
        this.signalingServer.onopen = function(_evt) {
            log("Connected to signaling server")
        }
        this.signalingServer.onclose = function(_evt) {
            log("Disconnected from signaling server")
        }
        this.signalingServer.onmessage = this.handleSignalMessage
        this.signalingServer.onerror = function(evt: Event) {
            log("Error connecting to signaling server: " + evt)
        }
    }

    handleSignalMessage(evt: MessageEvent) {
        let msg = JSON.parse(evt.data)
        log("Response from signaling server:")
        console.log(msg)
        switch(msg.type) {
            case "offer":
                handleOffer(msg)
                break
            case "answer":
                handleAnswer(msg)
                break
            case "forward":
                handleForward(msg)
                break
        }
    }

    download(addr: string) {

    }
}
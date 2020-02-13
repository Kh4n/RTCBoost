import * as types from "./dtypes_json"

class peerConn {
    p: RTCPeerConnection
    in: RTCDataChannel
    out: RTCDataChannel
}

class file {
    data: Map<number, Blob> = new Map<number, Blob>()
}

class RTCBooster {
    peerConns: Map<string, peerConn>
    peerConnNum = 0
    signalingServer: WebSocket
    files: Map<string, file>

    constructor(signalAddr: string) {
        this.peerConns = new Map<string, peerConn>()
        this.files = new Map<string, file>()

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

    signalToServer(msg: any) {
        this.signalingServer.send(JSON.stringify(msg))
    }

    handleSignalMessage(evt: MessageEvent) {
        let msg = JSON.parse(evt.data)
        log("Response from signaling server:")
        console.log(msg)
        let t: types.msgTypes = msg.type
        switch(t) {
            case "offer":
                handleOffer(msg)
                break
            case "answer":
                handleAnswer(msg)
                break
            case "forward":
                handleForward(msg)
                break
            
            case "infoResponse":
                let rsp: types.infoResponse = msg
                this.handleInfoResponse(rsp)
                break
        }
    }

    handleInfoResponse(rsp: types.infoResponse) {
        rsp.pieceList.forEach(piece => {
            let n: types.need = {type: "need", pieceID:  piece}
            this.signalToServer(n)
        });
    }

    download(fname: string, addrs: Array<string>) {
        this.files[fname] = new file()
        let info: types.info = {type: "info", name: fname}
        this.signalToServer(info)

        for (var i = 0; i < addrs.length; ++i) {
            if (this.files.get(fname).data.has(i)) {
                continue
            }

        }
    }
}



function log(text) {
    let time = new Date()
    console.log("[" + time.toLocaleTimeString() + "] " + text)
}
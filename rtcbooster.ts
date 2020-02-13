import * as types from "./dtypes_json"

class peerConn extends RTCPeerConnection {
    datachannel: RTCDataChannel
}

class file {
    data: Map<number, Blob> = new Map<number, Blob>()
}

class RTCBooster {
    peerConns: Map<string, peerConn>
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
            case "offer": {
                let rsp: types.offerOrAnswer = msg
                this.handleOffer(rsp)
                break
            }
            case "answer": {
                let rsp: types.offerOrAnswer = msg
                this.handleAnswer(rsp)
                break
            }
            case "forward": {
                let rsp: types.forward = msg
                this.handleForward(rsp)
                break
            }
            
            case "infoResponse": {
                let rsp: types.infoResponse = msg
                this.handleInfoResponse(rsp)
                break
            }
            case "needResponse": {
                let rsp: types.needResponse = msg
                this.handleNeedResponse(rsp)
                break
            }
            
            default:
                log("Server sent unknown data:")
                console.log(msg)
                break
        }
    }

    async handleOffer(rsp: types.offerOrAnswer) {
        let p: peerConn = new peerConn()
        
        this.peerConns.set(rsp.from, p)
        p.onicecandidate = this.generateICECandidateHandler(rsp.from)
        p.onconnectionstatechange = this.generateConnectionStateChangeHandler(rsp.from)
        p.onicegatheringstatechange = this.generateGatheringStateChangeHandler(rsp.from)
        
        let desc = new RTCSessionDescription(rsp)
        await p.setRemoteDescription(desc)
        await p.setLocalDescription(await p.createAnswer())
        let a: types.offerOrAnswer = {
            type: "answer",
            from: "",
            to: rsp.from,
            pieceID: rsp.pieceID,
            sdp: p.localDescription.sdp,
        }
        this.signalToServer(a)
        let options: RTCDataChannelInit = {negotiated: true, id: 0}
        p.datachannel = p.createDataChannel("dat", options)
    }

    async handleAnswer(rsp: types.offerOrAnswer) {
        let pc = this.peerConns.get(rsp.from)
        let desc = new RTCSessionDescription(rsp)
        await pc.setRemoteDescription(desc)
    }

    handleForward(rsp: types.forward) {
        // TODO: error handling :)
        let newICECandidate = JSON.parse(rsp.data)
        this.peerConns.get(rsp.from).addIceCandidate(newICECandidate)
    }

    async handleNeedResponse(rsp: types.needResponse) {
        // TODO: try to get same peer for as many as possible. right now we just grab the 
        // first remote peer they send us. might be better done on server side.
        if (rsp.peerList.length > 0 && !this.peerConns.has(rsp.peerList[0])) {
            let p: peerConn = new peerConn()
            this.peerConns.set(rsp.peerList[0], p)
            p.onicecandidate = this.generateICECandidateHandler(rsp.peerList[0])
            p.onconnectionstatechange = this.generateConnectionStateChangeHandler(rsp.peerList[0])
            p.onicegatheringstatechange = this.generateGatheringStateChangeHandler(rsp.peerList[0])

            let options: RTCDataChannelInit = {negotiated: true, id: 0}
            p.datachannel = p.createDataChannel("dat", options)

            const offer = await p.createOffer()
            await p.setLocalDescription(offer)
            log("Set our local description to:")
            console.log(offer)
            let o: types.offerOrAnswer = {
                type: "offer",
                from: "",
                to: rsp.peerList[0],
                pieceID: rsp.pieceID,
                sdp: p.localDescription.sdp
            }
            this.signalToServer(o)
        }
    }

    handleInfoResponse(rsp: types.infoResponse) {
        rsp.pieceList.forEach(piece => {
            let n: types.need = {type: "need", pieceID:  piece}
            this.signalToServer(n)
        });
    }

    generateICECandidateHandler(remotePeerID: string) {
        let s2s = this.signalToServer
        return function(ev: RTCPeerConnectionIceEvent) {
            if (ev.candidate) {
                log("Outgoing ICE candidate:")
                console.log(ev.candidate)
                let f: types.forward = {
                    type: "forward",
                    from: "",
                    to: remotePeerID,
                    data: JSON.stringify(ev.candidate),
                }
                s2s(f)
            }
        }
    }

    generateGatheringStateChangeHandler(remotePeerID: string) {
        let pcs = this.peerConns
        return function(_ev: Event) {
            log("Gathering state: " + pcs.get(remotePeerID).iceGatheringState)
        }
    }

    generateConnectionStateChangeHandler(remotePeerID: string) {
        let pcs = this.peerConns
        return function(_ev: Event) {
            log("ICE connection state: " + pcs.get(remotePeerID).iceConnectionState)
        }
    }
 
    download(fname: string, addrs: Array<string>) {
        this.files[fname] = new file()
        let info: types.info = {type: "info", name: fname}
        this.signalToServer(info)

        for (var i = 0; i < addrs.length; ++i) {
            if (this.files.get(fname).data.has(i)) {
                continue
            }
            var xhr = new XMLHttpRequest()
            xhr.open("get", addrs[i])
            xhr.responseType = "blob"
            let files = this.files
            let s2s = this.signalToServer
            xhr.onload = function() {
                files.get(fname).data.set(i, xhr.response)
                let a: types.action = {
                    type: "action",
                    name: fname,
                    pieceID: fname + i,
                    action: "add",
                }
                s2s(a)
            }
            xhr.send()
        }
    }
}



function log(text) {
    let time = new Date()
    console.log("[" + time.toLocaleTimeString() + "] " + text)
}
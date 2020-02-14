import * as types from "./dtypes_json"

class peerConn extends RTCPeerConnection {
    waiting: Array<string> = []
    datachannel: RTCDataChannel
}

// TODO: figure out how to send array buffers over reliably
class file {
    data: Map<number, string> = new Map<number, string>()
}

export class RTCBooster {
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
        this.signalingServer.onmessage = this.handleSignalMessage.bind(this)
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
        let files = this.files
        p.datachannel.onmessage = function(ev: MessageEvent) {
            log("Recieved peer MessageEvent:")
            console.log(ev)
            let msg = JSON.parse(ev.data)
            let t: types.clientMsg = msg.type
            switch(t) {
                case "request": {
                    let rq: types.request = msg
                    let pieceNum = parseInt(rq.pieceID.split(':').pop())
                    let s = files.get(rq.name).data.get(pieceNum)
                    let rsp: types.response = {
                        type: "response",
                        name: rq.name,
                        pieceID: rq.pieceID,
                        data: "placeholder",
                    }
                    this.send(JSON.stringify(rsp))
                    break
                }
                case "response": {
                    let rsp: types.response = msg
                    let pieceNum = parseInt(rsp.pieceID.split(':').pop())
                    files.get(rsp.name).data.set(pieceNum, rsp.data)
                }
            }
        }
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
            p.datachannel.onopen = function(_ev: Event) {
                log(p.waiting)
                while (p.waiting.length != 0) {
                    this.send(p.waiting.pop())
                }
                let rq: types.request = {
                    type: "request",
                    name: rsp.name,
                    pieceID: rsp.pieceID
                }
                this.send(JSON.stringify(rq))
            }
            let files = this.files
            p.datachannel.onmessage = function(ev: MessageEvent) {
                log("Recieved peer MessageEvent:")
                console.log(ev)
                let msg = JSON.parse(ev.data)
                let t: types.clientMsg = msg.type
                switch(t) {
                    case "request": {
                        let rq: types.request = msg
                        let pieceNum = parseInt(rq.pieceID.split(':').pop())
                        let s = files.get(rq.name).data.get(pieceNum)
                        let rsp: types.response = {
                            type: "response",
                            name: rq.name,
                            pieceID: rq.pieceID,
                            data: s
                        }
                        this.send(JSON.stringify(rsp))
                        break
                    }
                    case "response": {
                        let rsp: types.response = msg
                        let pieceNum = parseInt(rsp.pieceID.split(':').pop())
                        files.get(rsp.name).data.set(pieceNum, rsp.data)
                    }
                }
            }

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
        } else {
            log("Sending request to peer immediately")
            let dc = this.peerConns.get(rsp.peerList[0]).datachannel
            let rq: types.request = {
                type: "request",
                name: rsp.name,
                pieceID: rsp.pieceID
            }
            if (dc.readyState != "open") {
                this.peerConns.get(rsp.peerList[0]).waiting.push(JSON.stringify(rq))
            } else {
                dc.send(JSON.stringify(rq))
            }
        }
    }

    generatePeerMessageHandler() {
        let files = this.files
        return function(ev: MessageEvent) {
            log("Recieved peer MessageEvent:")
            console.log(ev)
            let msg = JSON.parse(ev.data)
            let t: types.clientMsg = msg.type
            switch(t) {
                case "request": {
                    let rq: types.request = msg
                    let pieceNum = parseInt(rq.pieceID.split(':').pop())
                    let s = files.get(rq.name).data.get(pieceNum)
                    let rsp: types.response = {
                        type: "response",
                        name: rq.name,
                        pieceID: rq.pieceID,
                        data: s
                    }
                    this.send(JSON.stringify(rsp))
                    break
                }
                case "response": {
                    let rsp: types.response = msg
                    let pieceNum = parseInt(rsp.pieceID.split(':').pop())
                    files.get(rsp.name).data.set(pieceNum, rsp.data)
                }
            }
        }
    }

    handleInfoResponse(rsp: types.infoResponse) {
        rsp.pieceList.forEach(piece => {
            let n: types.need = {
                type: "need",
                name: rsp.name,
                pieceID: piece,
            }
            this.signalToServer(n)
        });
    }

    generateICECandidateHandler(remotePeerID: string) {
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
                this.signalToServer(f)
            }
        }.bind(this)
    }

    generateGatheringStateChangeHandler(remotePeerID: string) {
        return function(_ev: Event) {
            log("Gathering state: " + this.peerConns.get(remotePeerID).iceGatheringState)
        }.bind(this)
    }

    generateConnectionStateChangeHandler(remotePeerID: string) {
        return function(_ev: Event) {
            log("ICE connection state: " + this.peerConns.get(remotePeerID).iceConnectionState)
        }.bind(this)
    }
 
    download(fname: string, addr: string, pieceNum: number) {
        if (!this.files.has(fname)) {
            this.files.set(fname, new file())
            let info: types.info = {type: "info", name: fname}
            this.signalToServer(info)
        }
        if (this.files.get(fname).data.has(pieceNum)) {
            log("Skipped pieceNum " + pieceNum)
            return
        }

        var xhr = new XMLHttpRequest()
        xhr.open("get", addr)
        xhr.responseType = "text"
        xhr.onload = function() {
            this.files.get(fname).data.set(pieceNum, xhr.response)
            let a: types.action = {
                type: "action",
                name: fname,
                pieceID: fname + ':' + pieceNum,
                action: "add",
            }
            this.signalToServer(a)
            log("Made action:")
            console.log(a)
        }.bind(this)
        xhr.send()
    }
}



function log(text) {
    let time = new Date()
    console.log("[" + time.toLocaleTimeString() + "] " + text)
}
// I cannot access the data channel from the peerconnection???
// let peerconns: Array<[RTCPeerConnection, RTCDataChannel]> = []
// let datachannels: Array<RTCDataChannel> = []
let peerconn: RTCPeerConnection = null
let datachannel: RTCDataChannel = null
let ws: WebSocket = null
let output: HTMLOutputElement = null
let input: HTMLInputElement = null
let peerID: HTMLInputElement = null
let remotePeerID: HTMLInputElement = null
let logDiv: HTMLDivElement = null

window.addEventListener("load", function(_evt) {
    logDiv = <HTMLDivElement>document.getElementById("log")

    initRTC()
    
    peerID = <HTMLInputElement>document.getElementById("peerID")
    remotePeerID = <HTMLInputElement>document.getElementById("remotePeerID")
    output = <HTMLOutputElement>document.getElementById("output")
    input = <HTMLInputElement>document.getElementById("input")
    document.getElementById("open").onclick = setupSocket
    document.getElementById("close").onclick = cleanup
    document.getElementById("connect").onclick = connectToPeer
    document.getElementById("send").onclick = sendMessage
})

function setupSocket(_event: MouseEvent) {
    if (ws) {
        return false
    }
    ws = new WebSocket("ws://localhost:6503")
    ws.onopen = function(_evt) {
        log("Connected to signaling server")
    }
    ws.onclose = function(_evt) {
        ws = null
        log("Disconnected from signaling server")
    }
    ws.onmessage = function(evt: MessageEvent) {
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
    ws.onerror = function(evt: Event) {
        log("Error connecting to signaling server: " + evt)
    }
    return false
}

async function handleForward(msg: any) {
    let newICECandidate = JSON.parse(msg.data)
    await peerconn.addIceCandidate(newICECandidate)
}

async function sendMessage(evt: MouseEvent) {
    evt.preventDefault()
    if (!ws) {
        log("Not connected to signaling server")
        return false
    }
    if (!datachannel) {
        log("Not connected to any peers")
        return false
    }
    if (datachannel.readyState != "open") {
        log("Data channel not open, retry periodically")
        return false
    }
    log("SEND: " + input.value)
    datachannel.send(input.value)
    return false
}

function initRTC() {
    log("Creating new RTCPeerConnection")

    peerconn = new RTCPeerConnection({
        iceServers: [
            {
                urls: "stun:stun.l.google.com:19302"
            }
        ]
    })
    peerconn.onicecandidate = handleICECandidate
    peerconn.onconnectionstatechange = handleConnectionStateChange
    peerconn.onicegatheringstatechange = handleICEGatheringStateChange

    peerconn.ondatachannel = handleRemoteDataChannel
    datachannel = peerconn.createDataChannel("dat")
}

function handleICECandidate(ev: RTCPeerConnectionIceEvent) {
    if (ev.candidate) {
        log("Outgoing ICE candidate:")
        console.log(ev.candidate)
        let forward = {
            type: "forward",
            from: peerID.value,
            to: remotePeerID.value,
            data: JSON.stringify(ev.candidate)
        }
        signalToServer(forward)
    }
}

function handleICEGatheringStateChange(_ev: Event) {
    log("Gathering state: " + peerconn.iceGatheringState)
}

function handleConnectionStateChange(_ev: Event) {
    log("ICE connection state changed to " + peerconn.iceConnectionState);
}

async function handleOffer(msg: any) {
    if (!peerconn) {
        log("No peer connection made")
        return
    }
    let desc = new RTCSessionDescription(msg) 
    peerconn.setRemoteDescription(desc)
    await peerconn.setLocalDescription(await peerconn.createAnswer())
    let serverMsg = {
        type: "answer",
        from: peerID.value,
        to: msg.from,
        sdp: peerconn.localDescription.sdp
    }
    signalToServer(serverMsg)
}

function handleRemoteDataChannel(ev: RTCDataChannelEvent) {
    let inbound = ev.channel
    inbound.onmessage = handleIncomingMessage
}

function handleIncomingMessage(ev: MessageEvent) {
    log("RECEIVE: " + ev.data)
}

async function handleAnswer(msg: any) {
    if (!peerconn) {
        log("No peer connection made")
        return
    }
    let desc = new RTCSessionDescription(msg)
    await peerconn.setRemoteDescription(desc)
    datachannel = peerconn.createDataChannel("dat")
    datachannel.onmessage = function(ev: MessageEvent) {
        log("Message recieved: " + ev.data)
    }
}

async function connectToPeer(ev: MouseEvent) {
    ev.preventDefault()
    if (!peerconn) {
        log("peerconn not initialized")
        return
    }

    const offer = await peerconn.createOffer()
    await peerconn.setLocalDescription(offer)
    console.log(peerconn.localDescription)
    let serverMsg = {
        type: "offer",
        from: peerID.value,
        to: remotePeerID.value,
        sdp: peerconn.localDescription.sdp
    }
    signalToServer(serverMsg)
}

function signalToServer(msg: any) {
    if (!ws) {
        log("Socket not initialized")
    }
    ws.send(JSON.stringify(msg))
}

function cleanup(ev: MouseEvent) {
    ev.preventDefault()
    if (peerconn) {
        datachannel.close()
        peerconn.close()
        datachannel = null
        peerconn = null
    }
    if (ws) {
        ws.close()
        ws = null
    }
    return false
}

function log(text) {
    let time = new Date()
    console.log("[" + time.toLocaleTimeString() + "] " + text)
    logDiv.innerHTML = logDiv.innerHTML + text + '<br>'
}
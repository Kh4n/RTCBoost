import {assert, log} from "./misc"
import * as types from "./dtypes_json"
import Peer from "simple-peer"
import boostPeer from "./boost_peer"
import {SwarmDownloadStrategy} from "./strategy"

export default class swarm {
    ourID: string
    peers: Record<string, boostPeer> = {}
    strategy: SwarmDownloadStrategy

    constructor(strategy: SwarmDownloadStrategy) {
        this.strategy = strategy
    }

    onsignalready: (forward: types.forward) => void

    notifysignaled(forward: types.forward) {
        if (!(forward.from in this.peers)) {
            this.addPeer(forward.from, false)
        }
        this.peers[forward.from].signal(forward.data)
    }

    notifypiececompleted(pieceNum: number) {
        this.strategy.notifypiececompleted(pieceNum)

        let h: types.have = {
            type: "have",
            pieceNums: [pieceNum]
        }
        for (let p of Object.values(this.peers)) {
            try {
                p.sendJSON(h)
            } catch (_) {
                log("Peer not stable, they will be notified when connection is stable")
            }
        }
    }

    setOurID(id: string) {
        this.ourID = id
    }

    addPeer(remotePeerID: string, initiator: boolean) {
        let p = new boostPeer({initiator: initiator})
        p.on("signal", function(data: Peer.SignalData) {
            let f: types.forward = {
                type: "forward",
                from: this.ourID,
                to: remotePeerID,
                data: JSON.stringify(data)
            }
            this.onsignalready(f)
        }.bind(this))

        // any time a peer connects it greets with the pieces it has
        p.on("connect", function() {
            ++this.swarmSize
            log("Peer with remote ID " + remotePeerID + " connected")
            let h: types.have = {
                type: "have",
                pieceNums: this.strategy.notifyneedinfo()
            }
            p.sendJSON(h)
        }.bind(this))

        p.on("data", this.strategy.generatePeerDataHandler(p))

        p.on("close", function() {
            this.strategy.notifypeerdisconnect(p)
            delete this.peers[remotePeerID]
            --this.swarmSize
            log("Peer with remote ID " + remotePeerID + " disconnected")
        }.bind(this))
        this.peers[remotePeerID] = p
    }
}
RTCBoost
========

A work in progress. Example in `example` folder. To run it first run these commands:

```
go build
tsc -p tsconfig.json
cd example
go build
browserify client.js -o client_dist.js
```
(`build.sh` has these commands as well)

You'll need Typescript, Go >= 1.12, `simple-peer`, and Browserify to run these, of course. To install `simple-peer` use:
```
npm install simple-peer
npm install -D @types/simple-peer
```

Then start up the example server and the boost server, and navigate to `http://localhost:8080` (or whatever port you chose) in two separate tabs. In the first, enter the signal server address (eg. `localhost:6503`), click Connect and then Download and wait ~10 secs (progress updates automatically). After it is done, go to the second tab and do the same. With any luck, it should download the entire thing almost immediately. You can also try downloading the first tab for ~5 secs and then switching tabs: it will seamlessly download the first half, and then proceed to download the rest. View the console for details (I print a ton of stuff, be warned).

This is an extremely basic proof of concept only at the moment. The end goal is to make a system that allows:
- People to offload work from a CDN via WebRTC
- To be able to do this with little to no setup (only need to be able to download in pieces, and know size of pieces)

To achieve the second goal, the boost server does not know anything about the data. When a user first downloads something, they tell the server what file they have. When another user tries to download the same thing, they ask the boost server join a swarm and find peers who might already have it. Then, once they connect with each other, they exchange what pieces they have. They can then request the necessary pieces. The larger the swarm, the more pieces can be simultaneously downloaded.

All this is well and good, if it weren't for the litany of issues that come with this approach :)
I will list some here:
- Verification of pieces is tough. Since we are trying to go for as little setup as possible, we need to calculate hashes on the fly. This is not a free operation, unfortunately. Browsers are getting faster, though, so it may not be as bad as it seems
- Peer connection stability isn't the greatest
- Browser support for this kind of stuff is not great either, but definitely not impossible
- Tons and tons of edge cases considering you are managing 3+ connections at all times, as a result of the hybrid peer/server approach this is using

Next steps:
- ~~Use WebRTC peer library. Using plain WebRTC was a good experience, but unless I make my own peer library it is not sustainable~~
    - Now using [simple-peer](https://github.com/feross/simple-peer)
- ~~Either use BitTorrent protocol or come up with own to allow peers to communicate (can't be JSON because binary limitation)~~
    - Used my own super simple protocol. Simply a type byte, piece number, and part number. Only weird thing is that I am storing this info at the end of the array, in the anticipation that [ArrayBuffer.transfer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/transfer) gets widely adopted
- ~~Send large amounts of data efficiently. The best way is to read the SDP and find optimum length (adapter.js does this). Right now it is fixed at 16Kb.~~
    - Pointless to read SDP, see http://viblast.com/blog/2015/2/5/webrtc-data-channel-message-size/. Even though article is old, I have tested reading the SDP and the results were subpar (didn't send at all at first, reducing the size introduced errors like pieces getting clipped halfway)
- ~Swarm load balancing. Right now each peer aggressively grabs as much as possible from just one peer (first it connects to)~
    - Basic greedy method: ask first peer for a piece that we need, then next...when a peer has delivered a piece all the way, we ask them again. Peers with better connections will automatically complete more pieces. Can be done much better still however
- ~Find a clever way to store the file. I have a few ideas how to solve this~
    - Well, the file API seems to be getting in my way as much as possible. I structured most of the code to be space efficient, only to have the File API make a complete copy every time it makes a file. Currently the code just copies everything over to a new contiguous ArrayBuffer and sets the pointers accordingly. Ideally the file would then use this same data, but it does not (it makes a copy). Looking for a way around this currently.
- Make server extensible so the backend storage can be swapped for something like Redis in practice
- Edge case handling (server disconnect, peer disconnect, signal server disconnect, and any combination at any time)
- Find and use a fast MD5 hash to verify, either on server or on client

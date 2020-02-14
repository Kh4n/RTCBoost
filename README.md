A work in progress. Example in `example` folder. To run it first run these commands:

```
go build
tsc -p tsconfig.json
cd example
go build
browserify client.js -o client_dist.js
```

You'll need Typescript, Go, and Browserify to run these, of course.

Then start up the example server and the boost server, and nagivate to `http://localhost:8080` in two separate tabs. In the first, click Download and wait ~10 secs (you can click update to see the progress). After it is done, go to the second tab and click Download. With any luck, it should download the entire thing immediately.
A note is that it does work properly. The RTCPeerConnection does not let me send the data effectively (see below), so I just send placeholders instead.

This is a extremely basic proof of concept only at the moment. The end goal is to make a system that allows:
- People to offload work from a CDN via WebRTC
- To be able to this with little to no setup (only need to be able to download in parts)

To achieve the second goal, the boost server does not know anything about the data. When a user first downloads something, they tell the server what they downloaded as well as what piece of the download they have. When another user tries to download the same thing, they ask the boost server for info on the file and recieve a list of pieces. Then, they go to each piece and request the server for peers that have that piece. A connection is then made with the peers, and a request is sent to transmit data. If a peer has multiple parts that the user needs, only one connection is made, and further requests are done only through the peer connection. After a user has downloaded parts from a peer, they also tell the server they have those parts, increasing the scope

All this is well and good, if it werent for the littany of issues that come with this approach :)
I will list some here:
- Verification of pieces is tough. Since we are trying to go for as little setup as possible, we need to calculate hashes on the fly. This is not a free operation, unfortunately. Browsers are getting faster, though so it may not be as bad as it seems
- Peer connection stability isn't the greatest
- Browser support for this kind of stuff is not great either, but definitely not impossible
- Tons and tons of edge cases considering you are managing 3+ connections at all times, as a result of the hybrid peer/server approach this is using

Next steps:
- Use WebRTC peer library. Using plain WebRTC was a good experience, but unless I make my own peer library it is not sustainable
- Either use bittorrent protocol or come up with own to allow peers to communicate (can't be JSON because binary limitation)
- Find a clever way to store the file. I have a few ideas how to solve this
- Make server extensible so the backend storage can be swapped for something like Redis in practice
- Edge case handling (server disconnect, peer disconnect, signal server disconnect, and any combination at any time)
- Find and use a fast MD5 hash to verify, either on server or on client

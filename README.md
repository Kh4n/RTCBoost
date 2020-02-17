A work in progress. Example in `example` folder. To run it first run these commands:

```
go build
tsc -p tsconfig.json
cd example
go build
browserify client.js -o client_dist.js
```

You'll need Typescript, Go >= 1.12, and Browserify to run these, of course.

Then start up the example server and the boost server, and nagivate to `http://localhost:8080` in two separate tabs. In the first, click Download and wait ~10 secs (progress updates automatically). After it is done, go to the second tab and click Download. With any luck, it should download the entire thing immediately. You can also try downloading the first tab for ~5 secs and then switching: it will seamlessly download the first half, and then proceed to download the rest. View the console for details (I print a ton of stuff, be warned).

This is a extremely basic proof of concept only at the moment. The end goal is to make a system that allows:
- People to offload work from a CDN via WebRTC
- To be able to this with little to no setup (only need to be able to download in pieces, and know size of pieces)

To achieve the second goal, the boost server does not know anything about the data. When a user first downloads something, they tell the server what piece of the download they have. When another user tries to download the same thing, they ask the boost server join a swarm and find peers who might already have it. Then, once they connect with any member of the swarm, they are told which pieces each member has. They can then request the necessary pieces.

All this is well and good, if it werent for the littany of issues that come with this approach :)
I will list some here:
- Verification of pieces is tough. Since we are trying to go for as little setup as possible, we need to calculate hashes on the fly. This is not a free operation, unfortunately. Browsers are getting faster, though, so it may not be as bad as it seems
- Peer connection stability isn't the greatest
- Browser support for this kind of stuff is not great either, but definitely not impossible
- Tons and tons of edge cases considering you are managing 3+ connections at all times, as a result of the hybrid peer/server approach this is using

Next steps:
- ~~Use WebRTC peer library. Using plain WebRTC was a good experience, but unless I make my own peer library it is not sustainable~~
    - Now using [simple-peer](https://github.com/feross/simple-peer)
- ~~Either use bittorrent protocol or come up with own to allow peers to communicate (can't be JSON because binary limitation)~~
    - Used my own super simple protocol. Simply a type byte, piece number, and part number. Only weird thing is that I am storing this info at the end of the array, in the anticipation that [ArrayBuffer.transfer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/transfer) gets widely adopted
- Send large amounts of data efficiently
    - The best way is to read the SDP and find optimum length (adapter.js does this). Right now it is fixed at 16Kb.
- Find a clever way to store the file. I have a few ideas how to solve this
- Make server extensible so the backend storage can be swapped for something like Redis in practice
- Edge case handling (server disconnect, peer disconnect, signal server disconnect, and any combination at any time)
- Find and use a fast MD5 hash to verify, either on server or on client

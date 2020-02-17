go build
tsc -p tsconfig.json
cd example
go build
browserify client.js -o client_dist.js
cd ../
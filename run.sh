trap 'sudo killall example' INT TERM EXIT
git pull
./build.sh
cd example
./example &
cd ../
./RTCBoost

var ws = null;
var uid = "";
var running_test = false;
var start_time = 0;
var points_received = {};

/////////////////////////////////////
// WEBSOCKET CODE
/////////////////////////////////////

const websocket_init = (() => {
    let host = window.location.host;
    ws = new WebSocket(`wss://${host}/connect`);
    ws.onmessage = (event) => {
        let msg = JSON.parse(event.data);
        switch (msg['Type']) {
            case 'init':
                uid = msg["Uid"];
                document.getElementById('connected_clients_num').innerHTML = msg['Users'].length
                document.getElementById('connected_clients').innerHTML = msg['Users'].map((val) => `<li>${val != uid ? val : val + ' (you)'}</li>`).join('\n')
                break;
            case 'signal':
                console.log('signal info received:', msg);
                gotMessageFromServer(msg);
                break;
            default:
                // write it back else count it as received
                if (!running_test) {
                    ws.send(JSON.stringify(msg));
                } else {
                    points_received[msg.id] = 1;
                    let test_length = parseInt(document.getElementById('test_length_input').value);
                    if (test_length == Object.keys(points_received).length) {
                        finish_ws_test();
                    }
                }
                break;
        }
    }
})();

const test_point = {
    "id": 0,
    "x": 1337,
    "y": 42
};

const finish_ws_test = () => {
    let end_time = performance.now();
    running_test = false;
    points_received = {};
    document.getElementById('ws_test_result').innerHTML = (end_time - start_time).toFixed(1);
    start_time = 0;
}

const run_ws_test = () => {
    if (document.getElementById('connected_clients').children.length != 2) {
        alert('must have exactly two clients connected!');
        return;
    }
    let test_length = parseInt(document.getElementById('test_length_input').value);
    running_test = true;
    document.getElementById('ws_test_result').innerHTML = "... currently running ...";
    start_time = performance.now();

    for (let i = 0; i < test_length; i++) {
        let point = Object.assign({}, test_point);
        point.id = i;
        ws.send(JSON.stringify(point));
    }
};

/////////////////////////////////////
// WEBRTC CODE (https://github.com/zcduthie/WebRTC-Example-RTCDataChannel/blob/master/client-datachannel/main.js)
/////////////////////////////////////

// RTC Variables!!
var peerConnection = null;  // RTCPeerConnection
var dataChannel = null;     // RTCDataChannel

var peerConnectionConfig = {
    'iceServers': [
        { 'urls': 'stun:stun.stunprotocol.org:3478' },
        { 'urls': 'stun:stun.l.google.com:19302' },
    ]
};

const run_webrtc_test = () => {
    if (document.getElementById('connected_clients').children.length != 2) {
        alert('must have exactly two clients connected!');
        return;
    }
    running_test = true;
    document.getElementById('webrtc_test_result').innerHTML = "... currently connecting ...";

    if (!peerConnection || !dataChannel || dataChannel.readyState != "open") {
        webrtc_init(true); // start up as the caller
    } else {
        start_webrtc_test();
    }
};

const webrtc_init = (isCaller) => {
    // sendButton.addEventListener('click', sendMessageThroughDataChannel, false);
    peerConnection = new RTCPeerConnection(peerConnectionConfig);
    peerConnection.onicecandidate = gotIceCandidate;

    // If we're the caller, we create the Data Channel
    // Otherwise, it opens for us and we receive an event as soon as the peerConnection opens
    if (isCaller) {
        dataChannel = peerConnection.createDataChannel("testChannel");
        dataChannel.onmessage = handleDataChannelReceiveMessage;
        dataChannel.onopen = handleDataChannelStatusChange;
        dataChannel.onclose = handleDataChannelStatusChange;
    } else {
        peerConnection.ondatachannel = handleDataChannelCreated;
    }

    // Kick it off (if we're the caller)
    if (isCaller) {
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => console.log('set local offer description'))
            .then(() => ws.send(JSON.stringify({ 'Type': 'signal', 'sdp': peerConnection.localDescription, 'Uid': uid })))
            .then(() => console.log('sent offer description to remote'))
            .catch(errorHandler);
    }
};

const gotMessageFromServer = (message) => {
    // If we haven't started WebRTC, now's the time to do it
    // We must be the receiver then (ie not the caller)
    if (!peerConnection) webrtc_init(false);

    // var signal = JSON.parse(message.data);
    let signal = message;

    console.log('signal: ' + message);

    if (signal.sdp) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp))
            .then(() => console.log('set remote description'))
            .then(function () {
                // Only create answers in response to offers
                if (signal.sdp.type == 'offer') {
                    console.log('got offer');

                    peerConnection.createAnswer()
                        .then(answer => peerConnection.setLocalDescription(answer))
                        .then(() => console.log('set local answer description'))
                        .then(() => ws.send(JSON.stringify({ 'Type': 'signal', 'sdp': peerConnection.localDescription, 'Uid': uid })))
                        .then(() => console.log('sent answer description to remote'))
                        .catch(errorHandler);
                }
            })
            .catch(errorHandler);
    } else if (signal.ice) {
        console.log('received ice candidate from remote');
        peerConnection.addIceCandidate(new RTCIceCandidate(signal.ice))
            .then(() => console.log('added ice candidate'))
            .catch(errorHandler);
    }
}

const gotIceCandidate = (event) => {
    if (event.candidate != null) {
        console.log('got ice candidate');
        ws.send(JSON.stringify({ 'Type': 'signal', 'ice': event.candidate, 'Uid': uid }))
        console.log('sent ice candiate to remote');
    }
}

const handleDataChannelCreated = (event) => {
    console.log('dataChannel opened');

    dataChannel = event.channel;
    dataChannel.onmessage = handleDataChannelReceiveMessage;
    dataChannel.onopen = handleDataChannelStatusChange;
    dataChannel.onclose = handleDataChannelStatusChange;
}

function handleDataChannelStatusChange(event) {
    if (dataChannel) {
        console.log("dataChannel status: " + dataChannel.readyState);

        if (dataChannel.readyState == "open" && running_test) {
            start_webrtc_test();
        }
    }
}

function handleDataChannelReceiveMessage(event) {
    // console.log("Message: " + event.data);
    let msg = JSON.parse(event.data);

    // write it back else count it as received
    if (!running_test) {
        dataChannel.send(JSON.stringify(msg));
    } else {
        points_received[msg.id] = 1;
        let test_length = parseInt(document.getElementById('test_length_input').value);
        if (test_length == Object.keys(points_received).length) {
            end_webrtc_test();
        }
    }
}

function errorHandler(error) {
    console.log(error);
}

////////// WEBRTC TEST CODE ///////////
const start_webrtc_test = () => {
    let test_length = parseInt(document.getElementById('test_length_input').value);
    document.getElementById('webrtc_test_result').innerHTML = "... currently running ...";
    start_time = performance.now();

    for (let i = 0; i < test_length; i++) {
        let point = Object.assign({}, test_point);
        point.id = i;
        dataChannel.send(JSON.stringify(point));
    }
}

const end_webrtc_test = () => {
    let end_time = performance.now();
    running_test = false;
    points_received = {};
    document.getElementById('webrtc_test_result').innerHTML = (end_time - start_time).toFixed(1);
    start_time = 0;
}

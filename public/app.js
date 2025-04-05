const socket = io();
let currentRoom = null;
let currentRoomId = null;
let localStream = null;
let peerConnections = {};
let username = 'User_' + Math.random().toString(36).substr(2, 6); // Generate random username

// DOM Elements
const roomNameInput = document.getElementById('roomName');
const roomIdInput = document.getElementById('roomId');
const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');
const startSharingBtn = document.getElementById('startSharing');
const stopSharingBtn = document.getElementById('stopSharing');
const streamsContainer = document.getElementById('streams-container');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const roomIdValue = document.querySelector('.room-id-value');
const copyRoomIdBtn = document.getElementById('copyRoomId');
const usernameInput = document.getElementById('usernameInput');
const saveUsernameBtn = document.getElementById('saveUsername');

// Initialize UI state
function initializeUI() {
    // Enable all interaction buttons initially
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled = false;
    startSharingBtn.disabled = true;
    stopSharingBtn.disabled = true;
    roomNameInput.disabled = false;
    roomIdInput.disabled = false;
    
    // Set initial username in input
    usernameInput.value = username;
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
});

// Debug function
function debug(message, data = null) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    if (data) {
        console.log(`[${timestamp}] ${message}:`, data);
    } else {
        console.log(`[${timestamp}] ${message}`);
    }
}

// Event Listeners
createRoomBtn.addEventListener('click', () => {
    const roomName = roomNameInput.value.trim();
    if (roomName) {
        debug('Creating room with name and username:', { roomName, username });
        socket.emit('create-room', { roomName, username });
        roomNameInput.value = ''; // Clear input after creating room
    } else {
        showNotification('Vui lòng nhập tên phòng', 'warning');
    }
});

joinRoomBtn.addEventListener('click', () => {
    let roomId = roomIdInput.value.trim();
    
    // Remove any non-alphanumeric characters and convert to uppercase
    roomId = roomId.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    
    if (roomId) {
        if (roomId.length !== 6) {
            showNotification('Mã phòng phải có 6 ký tự', 'warning');
            return;
        }
        debug('Joining room with ID and username:', { roomId, username });
        socket.emit('join-room', { roomId, username });
        roomIdInput.value = roomId; // Update input with cleaned room ID
    } else {
        showNotification('Vui lòng nhập mã phòng', 'warning');
    }
});

startSharingBtn.addEventListener('click', startScreenSharing);
stopSharingBtn.addEventListener('click', stopScreenSharing);

copyRoomIdBtn.addEventListener('click', () => {
    const roomId = roomIdValue.textContent;
    if (roomId) {
        navigator.clipboard.writeText(roomId).then(() => {
            showNotification('Đã sao chép mã phòng!', 'success');
        }).catch(() => {
            showNotification('Không thể sao chép mã phòng', 'error');
        });
    }
});

saveUsernameBtn.addEventListener('click', () => {
    const newUsername = usernameInput.value.trim();
    if (newUsername) {
        const oldUsername = username;
        username = newUsername;
        
        // Update username in current room if connected
        if (currentRoomId) {
            socket.emit('update-username', {
                roomId: currentRoomId,
                oldUsername: oldUsername,
                newUsername: username
            });
        }
        
        // Update local stream label if sharing
        const localContainer = document.getElementById(`stream-${socket.id}`);
        if (localContainer) {
            const label = localContainer.querySelector('.stream-label');
            if (label) {
                label.textContent = username;
            }
        }
        
        showNotification('Tên đã được cập nhật thành công!', 'success');
    } else {
        showNotification('Vui lòng nhập tên hợp lệ', 'warning');
    }
});

// Socket Events
socket.on('connect', () => {
    debug('Connected to server');
    showNotification('Đã kết nối tới máy chủ', 'success');
});

socket.on('connect_error', (error) => {
    debug('Connection error:', error);
    showNotification('Lỗi kết nối tới máy chủ', 'error');
});

socket.on('error', (message) => {
    debug('Error received from server:', message);
    showNotification(message, 'error');
});

socket.on('room-created', (data) => {
    debug('Room created event received:', data);
    try {
        if (!data || !data.roomId || !data.roomName) {
            throw new Error('Dữ liệu phòng không hợp lệ');
        }

        currentRoom = data.roomName;
        currentRoomId = data.roomId;
        updateUI(true);
        updateRoomIdDisplay(data.roomId);
        
        // Copy room ID to clipboard
        navigator.clipboard.writeText(data.roomId).then(() => {
            showNotification(`Phòng "${data.roomName}" đã được tạo! Mã phòng ${data.roomId} đã được sao chép`, 'success');
        }).catch(() => {
            showNotification(`Phòng "${data.roomName}" đã được tạo! Mã phòng: ${data.roomId}`, 'success');
        });
    } catch (error) {
        console.error('Error handling room data:', error);
        showNotification('Lỗi khi tạo phòng: ' + error.message, 'error');
        updateUI(false);
    }
});

socket.on('room-joined', (data) => {
    debug('Room joined event received:', data);
    try {
        if (!data || !data.roomId || !data.roomName) {
            throw new Error('Dữ liệu phòng không hợp lệ');
        }
        currentRoom = data.roomName;
        currentRoomId = data.roomId;
        updateUI(true);
        showNotification(`Đã tham gia phòng "${data.roomName}"`, 'success');
    } catch (error) {
        console.error('Error handling room join:', error);
        showNotification('Lỗi khi tham gia phòng: ' + error.message, 'error');
        updateUI(false);
    }
});

socket.on('room-not-found', (roomId) => {
    debug('Room not found:', roomId);
    showNotification(`Không tìm thấy phòng với mã ${roomId}`, 'error');
    updateUI(false);
});

socket.on('user-joined', ({ userId, username: joinedUsername }) => {
    debug('User joined:', { userId, username: joinedUsername });
    showNotification(`${joinedUsername} đã tham gia phòng`, 'info');
});

socket.on('user-left', ({ userId, username: leftUsername }) => {
    debug('User left:', { userId, username: leftUsername });
    showNotification(`${leftUsername} đã rời phòng`, 'info');
    removeStream(userId);
});

socket.on('room-closed', () => {
    debug('Room has been closed');
    currentRoom = null;
    currentRoomId = null;
    updateUI(false);
    showNotification('Phòng đã bị đóng bởi người tạo', 'warning');
    stopScreenSharing();
});

socket.on('active-streams', (streams) => {
    debug('Received active streams', streams);
    streams.forEach(async ({ streamId, username: streamUsername }) => {
        if (streamId !== socket.id && !peerConnections[streamId]) {
            debug('Creating peer connection for active stream', streamId);
            
            // Create empty container immediately with username
            const emptyContainer = createStreamContainer(streamId, null, streamUsername);
            streamsContainer.appendChild(emptyContainer);
            
            const pc = createPeerConnection(streamId);
            
            try {
                const offer = await pc.createOffer({
                    offerToReceiveVideo: true,
                    offerToReceiveAudio: true
                });
                debug('Created offer for stream', streamId);
                await pc.setLocalDescription(offer);
                debug('Set local description for stream', streamId);
                socket.emit('offer', {
                    offer: pc.localDescription,
                    streamId: streamId,
                    username: username
                });
                debug('Sent offer for stream', streamId);
            } catch (error) {
                console.error('Error creating offer:', error);
                showNotification('Lỗi khi kết nối với stream hiện có', 'error');
            }
        }
    });
});

socket.on('new-stream', async ({ streamId, username: streamUsername }) => {
    debug('New stream received', { streamId, username: streamUsername });
    if (streamId !== socket.id) {
        debug('Creating peer connection for new stream', streamId);
        
        // Create empty container immediately with username
        const emptyContainer = createStreamContainer(streamId, null, streamUsername);
        streamsContainer.appendChild(emptyContainer);
        
        const pc = createPeerConnection(streamId);
        
        try {
            const offer = await pc.createOffer({
                offerToReceiveVideo: true,
                offerToReceiveAudio: true
            });
            debug('Created offer for new stream', streamId);
            await pc.setLocalDescription(offer);
            debug('Set local description for new stream', streamId);
            socket.emit('offer', {
                offer: pc.localDescription,
                streamId: streamId,
                username: username
            });
            debug('Sent offer for new stream', streamId);
        } catch (error) {
            console.error('Error creating offer:', error);
            showNotification('Lỗi khi kết nối với stream mới', 'error');
        }
    }
});

socket.on('offer', async ({ offer, streamId }) => {
    debug('Received offer', { streamId });
    try {
        let pc = peerConnections[streamId];
        if (!pc) {
            debug('Creating new peer connection for offer', streamId);
            pc = createPeerConnection(streamId);
        }

        debug('Setting remote description from offer', streamId);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        debug('Remote description set successfully', streamId);
        
        // Create and send answer
        debug('Creating answer', streamId);
        const answer = await pc.createAnswer();
        debug('Setting local description (answer)', streamId);
        await pc.setLocalDescription(answer);
        debug('Local description set successfully', streamId);
        
        debug('Sending answer', streamId);
        socket.emit('answer', {
            answer: pc.localDescription,
            streamId: streamId
        });
    } catch (error) {
        console.error('Error handling offer:', error);
        showNotification('Error establishing connection', 'error');
    }
});

socket.on('answer', async ({ answer, streamId }) => {
    debug('Received answer', { streamId });
    try {
        const pc = peerConnections[streamId];
        if (pc) {
            debug('Setting remote description from answer', streamId);
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            debug('Remote description set successfully', streamId);
        }
    } catch (error) {
        console.error('Error handling answer:', error);
    }
});

socket.on('ice-candidate', async ({ candidate, streamId }) => {
    debug('Received ICE candidate for stream:', streamId);
    try {
        const pc = peerConnections[streamId];
        if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            debug('Added ICE candidate successfully');
        }
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
});

socket.on('stream-ended', (streamId) => {
    console.log('Stream ended:', streamId);
    removeStream(streamId);
});

socket.on('username-updated', ({ userId, oldUsername, newUsername }) => {
    debug('Username updated:', { userId, oldUsername, newUsername });
    
    // Update stream label if exists
    const container = document.getElementById(`stream-${userId}`);
    if (container) {
        const label = container.querySelector('.stream-label');
        if (label) {
            label.textContent = newUsername;
        }
    }
    
    showNotification(`${oldUsername} đã đổi tên thành ${newUsername}`, 'info');
});

// WebRTC Functions
async function startScreenSharing() {
    try {
        if (localStream) {
            debug('Stopping existing stream before starting new one');
            stopScreenSharing();
        }

        debug('Requesting screen sharing permission');
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                displaySurface: "monitor",
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            }
        });
        
        debug('Got local stream tracks:', localStream.getTracks().map(t => ({kind: t.kind, enabled: t.enabled})));

        // Create local preview
        const streamContainer = createStreamContainer(socket.id, localStream, username);
        streamsContainer.appendChild(streamContainer);
        
        // Notify server about new stream
        socket.emit('start-sharing', { roomId: currentRoomId, username });
        
        // Create new peer connections for all users in room
        const peerEntries = Object.entries(peerConnections);
        debug('Setting up peer connections:', peerEntries.length);
        
        for (const [streamId, pc] of peerEntries) {
            try {
                debug('Setting up connection for peer:', streamId);
                
                // Remove existing tracks
                const senders = pc.getSenders();
                senders.forEach(sender => {
                    if (sender.track) {
                        pc.removeTrack(sender);
                    }
                });
                
                // Add new tracks
                localStream.getTracks().forEach(track => {
                    debug('Adding track to peer connection:', { streamId, kind: track.kind, enabled: track.enabled });
                    pc.addTrack(track, localStream);
                });
                
                // Create and send offer
                const offer = await pc.createOffer({
                    offerToReceiveVideo: true,
                    offerToReceiveAudio: false
                });
                await pc.setLocalDescription(offer);
                
                socket.emit('offer', {
                    offer: pc.localDescription,
                    streamId: streamId,
                    username: username
                });
                debug('Sent offer to peer:', streamId);
            } catch (error) {
                console.error('Error setting up peer connection:', streamId, error);
                // Try to recreate the connection
                setTimeout(() => {
                    if (peerConnections[streamId]) {
                        createPeerConnection(streamId);
                    }
                }, 1000);
            }
        }
        
        updateSharingButtons(true);
        showNotification('Đã bắt đầu chia sẻ màn hình', 'success');

        // Handle stream end
        localStream.getVideoTracks()[0].onended = () => {
            debug('Local stream ended by user');
            stopScreenSharing();
        };
    } catch (error) {
        console.error('Error starting screen share:', error);
        showNotification('Không thể bắt đầu chia sẻ màn hình', 'error');
        stopScreenSharing();
    }
}

function stopScreenSharing() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        removeStream(socket.id);
        socket.emit('stop-sharing', currentRoomId);
        updateSharingButtons(false);
        showNotification('Đã dừng chia sẻ màn hình', 'info');
    }
}

function createPeerConnection(streamId) {
    debug('Creating peer connection for stream ID:', streamId);
    
    // Close existing connection if any
    if (peerConnections[streamId]) {
        debug('Closing existing peer connection:', streamId);
        peerConnections[streamId].close();
        delete peerConnections[streamId];
    }
    
    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
                urls: 'turn:a.relay.metered.ca:80',
                username: 'e899af9e1f0d66e68c5c7e38',
                credential: 'L6yxwXYlw+PuLHi/'
            },
            {
                urls: 'turn:a.relay.metered.ca:443',
                username: 'e899af9e1f0d66e68c5c7e38',
                credential: 'L6yxwXYlw+PuLHi/'
            },
            {
                urls: 'turn:a.relay.metered.ca:443?transport=tcp',
                username: 'e899af9e1f0d66e68c5c7e38',
                credential: 'L6yxwXYlw+PuLHi/'
            }
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceTransportPolicy: 'all'
    };

    const pc = new RTCPeerConnection(configuration);
    peerConnections[streamId] = pc;

    // Add local stream if we're sharing
    if (localStream) {
        debug('Adding local stream to peer connection');
        localStream.getTracks().forEach(track => {
            debug('Adding track to new peer connection:', { streamId, kind: track.kind, enabled: track.enabled });
            pc.addTrack(track, localStream);
        });
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            debug('Sending ICE candidate for:', streamId);
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                streamId: streamId
            });
        }
    };

    // Handle ICE connection state changes
    pc.oniceconnectionstatechange = () => {
        debug('ICE connection state changed:', { streamId, state: pc.iceConnectionState });
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            debug('ICE connection failed, restarting:', streamId);
            pc.restartIce();
        }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
        debug('Connection state changed:', { streamId, state: pc.connectionState });
        if (pc.connectionState === 'failed') {
            debug('Connection failed, recreating:', streamId);
            setTimeout(() => {
                if (peerConnections[streamId]) {
                    createPeerConnection(streamId);
                }
            }, 1000);
        }
    };

    // Handle receiving remote stream
    pc.ontrack = (event) => {
        debug('Received track from peer:', { streamId, kind: event.track.kind, enabled: event.track.enabled });
        const [remoteStream] = event.streams;
        if (remoteStream) {
            debug('Processing remote stream:', streamId);
            let container = document.getElementById(`stream-${streamId}`);
            
            if (!container) {
                debug('Creating new container for:', streamId);
                container = createStreamContainer(streamId, remoteStream);
                streamsContainer.appendChild(container);
            } else {
                debug('Updating existing container for:', streamId);
                const video = container.querySelector('video');
                if (video) {
                    // Stop existing stream if any
                    if (video.srcObject) {
                        video.srcObject.getTracks().forEach(track => track.stop());
                    }
                    
                    video.srcObject = remoteStream;
                    video.muted = true;
                    
                    // Force video element to refresh
                    video.style.display = 'none';
                    setTimeout(() => {
                        video.style.display = 'block';
                        video.play().catch(err => {
                            console.error('Error playing video:', err);
                            // Try to play again after a short delay
                            setTimeout(() => video.play().catch(e => console.error('Retry failed:', e)), 100);
                        });
                    }, 100);
                }
            }
        }
    };

    return pc;
}

// UI Functions
function createStreamContainer(streamId, stream, username) {
    debug('Creating stream container:', { streamId, username });
    const container = document.createElement('div');
    container.id = `stream-${streamId}`;
    container.className = 'stream-container';
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    
    // Add performance optimizations
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('x5-playsinline', '');
    
    // Optimize video playback
    video.addEventListener('loadedmetadata', () => {
        debug('Video metadata loaded:', streamId);
        video.play().catch(err => {
            console.error('Error playing video:', err);
            // Try to play again after a short delay
            setTimeout(() => video.play().catch(e => console.error('Retry failed:', e)), 100);
        });
    });

    // Add error handling
    video.addEventListener('error', (e) => {
        console.error('Video error:', e);
    });

    // Add connection state handling
    if (stream && stream.getVideoTracks()[0]) {
        stream.getVideoTracks()[0].onended = () => {
            debug('Video track ended:', streamId);
        };
    }

    const label = document.createElement('div');
    label.className = 'stream-label';
    label.textContent = username || 'Unknown User';

    container.appendChild(video);
    container.appendChild(label);
    return container;
}

function removeStream(streamId) {
    console.log('Removing stream:', streamId);
    const container = document.getElementById(`stream-${streamId}`);
    if (container) {
        container.remove();
    }
    if (peerConnections[streamId]) {
        peerConnections[streamId].close();
        delete peerConnections[streamId];
    }
}

function updateUI(isInRoom) {
    if (isInRoom) {
        startSharingBtn.disabled = false;
        stopSharingBtn.disabled = true;
        roomIdDisplay.classList.remove('d-none');
        roomNameInput.disabled = true;
        createRoomBtn.disabled = true;
        roomIdInput.disabled = true;
        joinRoomBtn.disabled = true;
    } else {
        startSharingBtn.disabled = true;
        stopSharingBtn.disabled = true;
        roomIdDisplay.classList.add('d-none');
        roomNameInput.disabled = false;
        createRoomBtn.disabled = false;
        roomIdInput.disabled = false;
        joinRoomBtn.disabled = false;
        roomIdInput.value = ''; // Clear room ID input
        roomNameInput.value = ''; // Clear room name input
        currentRoom = null;
        currentRoomId = null;
    }
}

function updateSharingButtons(isSharing) {
    startSharingBtn.disabled = isSharing;
    stopSharingBtn.disabled = !isSharing;
}

function updateRoomIdDisplay(roomId) {
    if (roomId) {
        roomIdValue.textContent = roomId;
    }
}

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show notification`;
    notification.role = 'alert';
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    
    const container = document.getElementById('notificationContainer');
    container.appendChild(notification);
    
    // Auto dismiss after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 150);
    }, 5000);
}

function updateStreamStatus(streamId, state) {
    const container = document.getElementById(`stream-${streamId}`);
    if (container) {
        const video = container.querySelector('video');
        if (video && !video.srcObject) {
            video.style.display = 'none';
        } else if (video) {
            video.style.display = 'block';
        }
    }
} 
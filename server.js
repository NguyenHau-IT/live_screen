const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Store rooms and their active streams
const rooms = new Map();

// Debug function to log rooms
function logRooms() {
    console.log('\nCurrent Rooms:');
    console.log('Total rooms:', rooms.size);
    console.log('Room IDs:', Array.from(rooms.keys()));
    rooms.forEach((room, roomId) => {
        console.log(`Room ${roomId}:`, {
            name: room.name,
            host: room.host,
            users: Array.from(room.users.entries()),
            streams: Array.from(room.streams.keys())
        });
    });
}

// Generate a random room ID
function generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Clean room ID function
function cleanRoomId(roomId) {
    return roomId.toString().replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

function getRoomInfo(roomId) {
    const room = rooms.get(roomId);
    if (!room) return null;
    
    return {
        roomId: roomId,
        roomName: room.name,
        host: room.host,
        users: Array.from(room.users.entries()).map(([id, name]) => ({ id, name })),
        streams: Array.from(room.streams.entries()).map(([id, name]) => ({ id, name }))
    };
}

function validateRoomId(roomId) {
    // Check if room ID is exactly 6 alphanumeric characters
    return /^[A-Z0-9]{6}$/.test(roomId);
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    let currentRoom = null;

    // Debug: Log current rooms on connection
    logRooms();

    socket.on('create-room', ({ roomName, username }) => {
        try {
            if (!roomName || !username) {
                throw new Error('Thiếu thông tin tên phòng hoặc tên người dùng');
            }

            // Generate room ID and ensure it's unique
            let roomId;
            do {
                roomId = generateRoomId();
            } while (rooms.has(roomId));

            console.log('Creating room with ID:', roomId);

            const roomData = {
                name: roomName.toString().trim(),
                host: socket.id,
                streams: new Map(),
                users: new Map([[socket.id, username.toString().trim()]])
            };

            // Store room in Map
            rooms.set(roomId, roomData);
            console.log('Room stored in Map. Current rooms:', Array.from(rooms.keys()));

            // Set current room for this socket
            currentRoom = roomId;
            socket.join(roomId);

            console.log(`Room created successfully: ${roomId}`);
            console.log(`Details: Name="${roomName}", Host="${username}" (${socket.id})`);
            logRooms();

            socket.emit('room-created', {
                roomId: roomId,
                roomName: roomData.name
            });
        } catch (error) {
            console.error('Error creating room:', error);
            socket.emit('error', 'Lỗi khi tạo phòng: ' + error.message);
        }
    });

    socket.on('join-room', ({ roomId, username }) => {
        try {
            if (!roomId) {
                throw new Error('Thiếu mã phòng');
            }

            // Clean and validate room ID
            roomId = cleanRoomId(roomId);
            console.log(`Attempting to join room: { roomId: '${roomId}' }`);
            console.log('Current rooms in Map:', Array.from(rooms.keys()));
            console.log('Room exists check:', rooms.has(roomId));

            const room = rooms.get(roomId);
            console.log('Room data:', room);

            if (!room) {
                console.log(`Room not found: { roomId: '${roomId}' }`);
                socket.emit('room-not-found', roomId);
                return;
            }

            // Use a default username if none provided
            username = username || 'User_' + Math.random().toString(36).substr(2, 6);
            username = username.toString().trim();

            // Leave current room if in one
            if (currentRoom) {
                const oldRoom = rooms.get(currentRoom);
                if (oldRoom) {
                    oldRoom.users.delete(socket.id);
                    oldRoom.streams.delete(socket.id);
                    socket.leave(currentRoom);
                    
                    // If old room is empty, remove it
                    if (oldRoom.users.size === 0) {
                        rooms.delete(currentRoom);
                        console.log(`Empty room removed: ${currentRoom}`);
                    }
                }
            }

            // Join new room
            currentRoom = roomId;
            room.users.set(socket.id, username);
            socket.join(roomId);

            console.log(`User joined successfully: { roomId: '${roomId}', username: '${username}' }`);
            
            // Notify others in the room
            socket.to(roomId).emit('user-joined', {
                userId: socket.id,
                username: username
            });

            // Send room info to the new participant
            socket.emit('room-joined', {
                roomId: roomId,
                roomName: room.name
            });

            // Send active streams to the new participant
            const activeStreams = Array.from(room.streams.entries()).map(([streamId, streamUsername]) => ({
                streamId,
                username: streamUsername
            }));

            if (activeStreams.length > 0) {
                console.log('Sending active streams to new participant:', activeStreams);
                socket.emit('active-streams', activeStreams);
            }

            logRooms();
        } catch (error) {
            console.error('Error joining room:', error);
            socket.emit('error', 'Lỗi khi tham gia phòng: ' + error.message);
        }
    });

    socket.on('start-sharing', ({ roomId, username }) => {
        try {
            const room = rooms.get(roomId);
            if (room) {
                room.streams.set(socket.id, username);
                
                // Notify ALL users in the room about the new stream
                io.to(roomId).emit('new-stream', { 
                    streamId: socket.id,
                    username: username
                });
                
                // Send list of all current streams to the new sharer
                const activeStreams = Array.from(room.streams.entries())
                    .filter(([id]) => id !== socket.id)
                    .map(([streamId, streamUsername]) => ({
                        streamId,
                        username: streamUsername
                    }));
                
                if (activeStreams.length > 0) {
                    socket.emit('active-streams', activeStreams);
                }
                
                console.log(`User ${username} (${socket.id}) started sharing in room: ${roomId}`);
                console.log('Current streams in room:', Array.from(room.streams.entries()));
            }
        } catch (error) {
            console.error('Error starting share:', error);
            socket.emit('error', 'Lỗi khi bắt đầu chia sẻ màn hình');
        }
    });

    socket.on('stop-sharing', (roomId) => {
        try {
            const room = rooms.get(roomId);
            if (room) {
                room.streams.delete(socket.id);
                io.to(roomId).emit('stream-ended', socket.id);
                console.log(`User ${socket.id} stopped sharing in room: ${roomId}`);
            }
        } catch (error) {
            console.error('Error stopping share:', error);
            socket.emit('error', 'Lỗi khi dừng chia sẻ màn hình');
        }
    });

    // Handle WebRTC signaling
    socket.on('offer', ({ offer, streamId, username }) => {
        console.log('Forwarding offer from', username, `(${socket.id})`, 'to', streamId);
        io.to(streamId).emit('offer', {
            offer,
            streamId: socket.id,
            username: username
        });
    });

    socket.on('answer', ({ answer, streamId }) => {
        const room = rooms.get(currentRoom);
        const username = room ? room.users.get(socket.id) : 'Unknown';
        console.log('Forwarding answer from', username, `(${socket.id})`, 'to', streamId);
        io.to(streamId).emit('answer', {
            answer,
            streamId: socket.id,
            username: username
        });
    });

    socket.on('ice-candidate', ({ candidate, streamId }) => {
        console.log('Forwarding ICE candidate from', socket.id, 'to', streamId);
        io.to(streamId).emit('ice-candidate', {
            candidate,
            streamId: socket.id
        });
    });

    socket.on('update-username', ({ roomId, oldUsername, newUsername }) => {
        try {
            const room = rooms.get(roomId);
            if (room) {
                // Update username in users map
                room.users.set(socket.id, newUsername);
                
                // Update username in streams map if user is streaming
                if (room.streams.has(socket.id)) {
                    room.streams.set(socket.id, newUsername);
                }
                
                // Notify all users in the room about the username change
                io.to(roomId).emit('username-updated', {
                    userId: socket.id,
                    oldUsername: oldUsername,
                    newUsername: newUsername
                });
                
                console.log(`User ${oldUsername} changed name to ${newUsername} in room ${roomId}`);
            }
        } catch (error) {
            console.error('Error updating username:', error);
            socket.emit('error', 'Lỗi khi cập nhật tên');
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                const username = room.users.get(socket.id);
                room.users.delete(socket.id);
                
                // Notify others about user disconnect
                socket.to(currentRoom).emit('user-left', {
                    userId: socket.id,
                    username: username
                });

                if (room.host === socket.id) {
                    // If host disconnects, close the room
                    io.to(currentRoom).emit('room-closed');
                    rooms.delete(currentRoom);
                    console.log(`Room ${currentRoom} closed because host ${username} (${socket.id}) disconnected`);
                } else if (room.streams.has(socket.id)) {
                    // If sharing user disconnects, notify others
                    room.streams.delete(socket.id);
                    io.to(currentRoom).emit('stream-ended', socket.id);
                    console.log(`Stream ended because user ${username} (${socket.id}) disconnected from room ${currentRoom}`);
                }

                // If room is empty, remove it
                if (room.users.size === 0) {
                    rooms.delete(currentRoom);
                    console.log(`Room ${currentRoom} removed because it's empty`);
                }

                logRooms();
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 
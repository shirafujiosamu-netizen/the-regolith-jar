process.chdir(__dirname);   // 确保工作目录正确
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');   // 添加这一行
// 如果使用 axios，建议用绝对路径
const axios = require('/home/admin/the-regolith-jar/node_modules/axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 存储在线用户 { nickname, avatar, currentRoom, ip }
const users = new Map();

// 消息历史
const messageHistory = [];
const MAX_HISTORY = 1000;

// 工单目录
const ticketsDir = path.join(__dirname, 'tickets');
const pendingDir = path.join(ticketsDir, 'pending');
const processedDir = path.join(ticketsDir, 'processed');
if (!fs.existsSync(ticketsDir)) fs.mkdirSync(ticketsDir);
if (!fs.existsSync(pendingDir)) fs.mkdirSync(pendingDir);
if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir);

// ========== 房间数据 ==========
const rooms = new Map();
rooms.set('public', {
  id: 'public',
  name: '公共大厅',
  avatar: '🌐',
  requireApproval: false,
  creatorId: null,
  creatorIP: null,
  members: [],
  pending: [],
  blacklist: [],        // 存储 socket.id，但为了持久化，可能需改进，此处保持原样
  approvedIPs: [],      // 新增：已批准的 IP 列表（包括房主）
  ownerPlaylist: null,
  ownerPlaylistId: null
});

// 房间名称前缀和主题词列表
const namePrefixes = ['阴暗地', '阳光地', '绝望地', '可爱地', '扭曲地', '安静地', '热闹地', '神秘地', '复古地', '未来地'];
const nameTopics = ['开黑', '考研', '考公', '考编', '论文', '自习', '摸鱼', '发呆', '追番', '游戏', '音乐', '阅读'];

// 头像管理
const commonAvatars = ['😀', '😎', '🐶', '🐱', '🐼', '🦊', '🐨', '🐸', '🐧', '🦉', '🌟', '🎈', '🌞', '🌙', '⭐', '🌈', '🍀', '🎮', '📚', '🎵', '☕'];

// 允许使用章鱼头像和拥有特殊权限的 IP 列表（你提供的两个IP）
const allowedOctopusIPs = ['140.206.194.172', '101.82.202.146'];

// ========== 加载违禁词列表 ==========
let badWords = [];
const badWordsPath = path.join(__dirname, 'badwords.json');
try {
    if (fs.existsSync(badWordsPath)) {
        const data = fs.readFileSync(badWordsPath, 'utf8');
        badWords = JSON.parse(data);
        console.log(`已加载 ${badWords.length} 个违禁词`);
    } else {
        console.log('未找到违禁词文件，将使用空列表');
    }
} catch (err) {
    console.error('加载违禁词失败:', err);
}

function getAllowedAvatars(ip) {
  if (allowedOctopusIPs.includes(ip)) {
    return [...commonAvatars, '🐙'];
  }
  return commonAvatars;
}
io.on('connection', (socket) => {
  console.log('新连接:', socket.id);

  // 获取原始IP（可能包含IPv6映射）
  const forwardedFor = socket.handshake.headers['x-forwarded-for'];
  let rawIP = forwardedFor ? forwardedFor.split(',')[0].trim() : socket.handshake.address;

  // 标准化：如果是IPv6映射地址（::ffff:...），提取IPv4部分
  let clientIP = rawIP;
  if (rawIP.includes('::ffff:')) {
      clientIP = rawIP.split('::ffff:')[1];
  } else if (rawIP === '::1') {
      clientIP = '127.0.0.1';
  }
  console.log('客户端IP (处理后):', clientIP);

  // 检查IP权限
  socket.on('check ip', () => {
    const hasOctopus = allowedOctopusIPs.includes(clientIP);
    socket.emit('ip check result', hasOctopus);
  });

  // 用户设置信息
  socket.on('set user info', (userInfo) => {
    const { nickname, avatar } = userInfo;
    const user = { nickname, avatar, currentRoom: 'public', ip: clientIP };
    users.set(socket.id, user);
    const room = rooms.get('public');
    if (room) {
      socket.join('public');
      user.currentRoom = 'public';
      if (!room.members.includes(socket.id)) {
        room.members.push(socket.id);
      }
    }
    console.log(`用户 ${nickname} (${socket.id}) 加入了公共大厅，IP: ${clientIP}`);

    socket.emit('your id', socket.id);
    socket.to('public').emit('system message', `${nickname} 加入了聊天室`);
    socket.emit('system message', `欢迎 ${nickname} 进入聊天室！当前房间：公共大厅`);
    socket.emit('room changed', { roomId: 'public', roomName: '公共大厅' });
    socket.emit('room list', Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      requireApproval: r.requireApproval,
      memberCount: r.members.length,
      creatorId: r.creatorId,
      creatorIP: r.creatorIP,
      ownerPlaylist: r.ownerPlaylist,
      ownerPlaylistId: r.ownerPlaylistId
    })));
  });

  // 获取房间列表
  socket.on('get rooms', () => {
    socket.emit('room list', Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      requireApproval: r.requireApproval,
      memberCount: r.members.length,
      creatorId: r.creatorId,
      creatorIP: r.creatorIP,
      ownerPlaylist: r.ownerPlaylist,
      ownerPlaylistId: r.ownerPlaylistId
    })));
  });

  // 获取房间名称选项
  socket.on('get room name options', () => {
    socket.emit('room name options', { prefixes: namePrefixes, topics: nameTopics });
  });

  // 创建房间
  socket.on('create room', ({ prefix, topic, avatar, requireApproval }) => {
    const user = users.get(socket.id);
    if (!user) return;

    const allowedAvatars = getAllowedAvatars(user.ip);
    if (!allowedAvatars.includes(avatar)) {
      socket.emit('system message', '头像选择不合法');
      return;
    }

    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const roomName = prefix + topic;

    const newRoom = {
      id: roomId,
      name: roomName,
      avatar: avatar,
      requireApproval: requireApproval,
      creatorId: socket.id,
      creatorIP: user.ip,
      members: [socket.id],
      pending: [],
      blacklist: [],
      approvedIPs: [user.ip], // 房主 IP 加入批准列表
      ownerPlaylist: null,
      ownerPlaylistId: socket.id
    };
    rooms.set(roomId, newRoom);

    const oldRoomId = user.currentRoom;
    if (oldRoomId && oldRoomId !== roomId) {
      if (!oldRoomId.startsWith('private:')) {
        const oldRoom = rooms.get(oldRoomId);
        if (oldRoom) {
          const idx = oldRoom.members.indexOf(socket.id);
          if (idx !== -1) oldRoom.members.splice(idx, 1);
          socket.leave(oldRoomId);
          socket.to(oldRoomId).emit('system message', `${user.nickname} 离开了房间`);
        }
      } else {
        socket.leave(oldRoomId);
        socket.to(oldRoomId).emit('system message', `${user.nickname} 离开了房间`);
      }
    }

    socket.join(roomId);
    user.currentRoom = roomId;

    socket.emit('room changed', { roomId: roomId, roomName: roomName });
    socket.to(roomId).emit('system message', `${user.nickname} 创建并加入了房间`);

    io.emit('room list', Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      requireApproval: r.requireApproval,
      memberCount: r.members.length,
      creatorId: r.creatorId,
      creatorIP: r.creatorIP,
      ownerPlaylist: r.ownerPlaylist,
      ownerPlaylistId: r.ownerPlaylistId
    })));
  });

  // 解散房间（所有房间均可由特殊IP解散）
  socket.on('dissolve room', ({ roomId }) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(roomId);
    if (!room) return;

    // 权限判断：房主（基于IP） 或 特殊IP
    const isOwnerByIp = (room.creatorIP === user.ip);
    const isSpecialIP = allowedOctopusIPs.includes(user.ip);
    const canDissolve = isOwnerByIp || isSpecialIP;

    if (!canDissolve) {
      socket.emit('system message', '你没有权限解散该房间');
      return;
    }

    room.members.forEach(memberId => {
      const memberSocket = io.sockets.sockets.get(memberId);
      if (memberSocket) {
        memberSocket.leave(roomId);
        memberSocket.emit('system message', `房间 ${room.name} 已被解散`);
        const member = users.get(memberId);
        if (member) {
          joinRoom(memberSocket, 'public');
        }
      }
    });
    rooms.delete(roomId);
    io.emit('room list', Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      requireApproval: r.requireApproval,
      memberCount: r.members.length,
      creatorId: r.creatorId,
      creatorIP: r.creatorIP,
      ownerPlaylist: r.ownerPlaylist,
      ownerPlaylistId: r.ownerPlaylistId
    })));
    socket.emit('system message', '房间已解散');
  });

  // 申请加入房间
  socket.on('join room', ({ roomId }) => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.blacklist.includes(socket.id)) {
      socket.emit('system message', '你已被该房间拉黑，无法加入');
      return;
    }
    if (room.members.includes(socket.id)) return;

    // 房主回归：如果该用户的IP是房主IP，直接加入
    if (room.creatorIP === user.ip) {
      room.creatorId = socket.id;
      room.ownerPlaylistId = socket.id;
      joinRoom(socket, roomId);
      return;
    }

    // 如果用户IP已在批准列表中，直接加入（即使房间需要审核）
    if (room.approvedIPs.includes(user.ip)) {
      joinRoom(socket, roomId);
      return;
    }

    if (room.requireApproval && roomId !== 'public') {
      if (!room.pending.includes(socket.id)) {
        room.pending.push(socket.id);
        socket.emit('system message', `已申请加入 ${room.name}，等待房主批准`);
        if (room.creatorId) {
          const creatorSocket = io.sockets.sockets.get(room.creatorId);
          if (creatorSocket) {
            creatorSocket.emit('pending member', {
              roomId: room.id,
              roomName: room.name,
              applicantId: socket.id,
              applicantName: user.nickname,
              applicantAvatar: user.avatar
            });
          }
        }
      }
      return;
    }

    joinRoom(socket, roomId);
  });

  // 房主批准成员
  socket.on('approve member', ({ roomId, applicantId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const user = users.get(socket.id);
    if (!user) return;
    if (room.creatorIP !== user.ip) {
      socket.emit('system message', '你不是该房间房主，无法批准');
      return;
    }
    const index = room.pending.indexOf(applicantId);
    if (index === -1) return;
    room.pending.splice(index, 1);
    const applicantSocket = io.sockets.sockets.get(applicantId);
    if (applicantSocket) {
      const applicantUser = users.get(applicantId);
      if (applicantUser) {
        // 将申请人 IP 加入批准列表
        room.approvedIPs.push(applicantUser.ip);
      }
      joinRoom(applicantSocket, roomId);
      applicantSocket.emit('system message', `你已获批准加入 ${room.name}`);
    }
    socket.emit('system message', `已批准用户加入`);
  });

  // 房主拒绝成员
  socket.on('reject member', ({ roomId, applicantId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const user = users.get(socket.id);
    if (!user) return;
    if (room.creatorIP !== user.ip) return;
    const index = room.pending.indexOf(applicantId);
    if (index === -1) return;
    room.pending.splice(index, 1);
    const applicantSocket = io.sockets.sockets.get(applicantId);
    if (applicantSocket) {
      applicantSocket.emit('system message', `你被拒绝加入 ${room.name}`);
    }
    socket.emit('system message', `已拒绝用户`);
  });

  // 切换单人房
  socket.on('switch room', ({ roomType }) => {
    const user = users.get(socket.id);
    if (!user) return;
    if (roomType === 'private') {
      handlePrivateRoom(socket);
    } else {
      joinRoom(socket, 'public');
    }
  });

  function handlePrivateRoom(socket) {
    const user = users.get(socket.id);
    if (!user) return;
    const oldRoom = user.currentRoom;
    if (!oldRoom || oldRoom.startsWith('private:')) return;
    const privateRoomId = `private:${socket.id}`;
    socket.leave(oldRoom);
    socket.join(privateRoomId);
    if (!oldRoom.startsWith('private:')) {
      const oldRoomObj = rooms.get(oldRoom);
      if (oldRoomObj) {
        const idx = oldRoomObj.members.indexOf(socket.id);
        if (idx !== -1) oldRoomObj.members.splice(idx, 1);
      }
    }
    user.currentRoom = privateRoomId;
    socket.to(oldRoom).emit('system message', `${user.nickname} 离开了房间`);
    socket.emit('system message', `你已切换到单人自习室`);
    socket.emit('room changed', { roomType: 'private' });
  }

  function joinRoom(socket, roomId) {
    const user = users.get(socket.id);
    if (!user) return;
    const oldRoomId = user.currentRoom;
    if (oldRoomId === roomId) return;
    const newRoom = rooms.get(roomId);
    if (!newRoom) return;

    // 离开旧房间
    if (oldRoomId && !oldRoomId.startsWith('private:')) {
      const oldRoom = rooms.get(oldRoomId);
      if (oldRoom) {
        const idx = oldRoom.members.indexOf(socket.id);
        if (idx !== -1) oldRoom.members.splice(idx, 1);
        socket.leave(oldRoomId);
        socket.to(oldRoomId).emit('system message', `${user.nickname} 离开了房间`);
      }
    } else if (oldRoomId && oldRoomId.startsWith('private:')) {
      socket.leave(oldRoomId);
      socket.to(oldRoomId).emit('system message', `${user.nickname} 离开了房间`);
    }

    socket.join(roomId);
    newRoom.members.push(socket.id);
    user.currentRoom = roomId;

    if (roomId === 'public') {
      newRoom.creatorId = null;
    }

    socket.to(roomId).emit('system message', `${user.nickname} 加入了房间`);
    socket.emit('system message', `你已加入 ${newRoom.name}`);
    socket.emit('room changed', { roomId: roomId, roomName: newRoom.name });

    // 如果房间有房主共享的歌单，且当前用户不是房主，则通知该用户播放房主歌单
    if (newRoom.ownerPlaylist && newRoom.ownerPlaylistId !== socket.id) {
      socket.emit('playlist changed', newRoom.ownerPlaylist);
    }

    io.emit('room list', Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      requireApproval: r.requireApproval,
      memberCount: r.members.length,
      creatorId: r.creatorId,
      creatorIP: r.creatorIP,
      ownerPlaylist: r.ownerPlaylist,
      ownerPlaylistId: r.ownerPlaylistId
    })));
  }

  // ========== 聊天消息（已修改，加入违禁词检测） ==========
  socket.on('chat message', (msgText) => {
    const user = users.get(socket.id);
    if (!user) return;

    // 获取当前房间
    const room = rooms.get(user.currentRoom);
    // 如果当前房间是需审核房间，进行违禁词检测（单人房不在rooms中，room为undefined，不检测）
    if (room && room.requireApproval) {
      // 图片消息放行（以[IMG]开头）
      if (!msgText.startsWith('[IMG]')) {
        const lowerMsg = msgText.toLowerCase();
        const found = badWords.some(word => lowerMsg.includes(word.toLowerCase()));
        if (found) {
          socket.emit('system message', '消息包含违禁词，已被屏蔽');
          return;
        }
      }
    }

    const { nickname, avatar, currentRoom, ip } = user;
    const message = {
      socketId: socket.id,
      nickname,
      avatar,
      text: msgText,
      room: currentRoom,
      ip,
      timestamp: Date.now()
    };
    messageHistory.push(message);
    if (messageHistory.length > MAX_HISTORY) messageHistory.shift();

    io.to(currentRoom).emit('chat message', {
      socketId: socket.id,
      nickname,
      avatar,
      text: msgText,
      timestamp: Date.now()
    });
  });

  // 拉黑举报
  socket.on('blacklist', (targetSocketId, alsoBlockIP = false) => {
    const reporter = users.get(socket.id);
    if (!reporter) return;
    const targetUser = users.get(targetSocketId);
    const targetMessages = messageHistory.filter(msg => msg.socketId === targetSocketId);
    if (targetMessages.length === 0) {
      socket.emit('system message', '未找到该用户的消息记录');
      return;
    }
    const targetInfo = targetUser || {
      nickname: targetMessages[0].nickname,
      avatar: targetMessages[0].avatar,
      ip: targetMessages[0].ip,
      socketId: targetSocketId
    };
    const ticket = {
      id: `${Date.now()}-${targetSocketId}`,
      timestamp: Date.now(),
      reporter: {
        socketId: socket.id,
        nickname: reporter.nickname,
        avatar: reporter.avatar,
        ip: reporter.ip
      },
      target: {
        socketId: targetSocketId,
        nickname: targetInfo.nickname,
        avatar: targetInfo.avatar,
        ip: targetInfo.ip
      },
      alsoBlockIP: alsoBlockIP,
      messages: targetMessages.map(m => ({
        timestamp: m.timestamp,
        text: m.text,
        room: m.room
      })),
      status: 'pending'
    };
    const filename = `pending_${ticket.id}.json`;
    const filePath = path.join(pendingDir, filename);
    fs.writeFile(filePath, JSON.stringify(ticket, null, 2), (err) => {
      if (err) {
        console.error('写入工单失败:', err);
        socket.emit('system message', '举报失败');
      } else {
        socket.emit('system message', '举报成功，工单已提交');
      }
    });
  });

  // 房主踢人（拉黑）
  socket.on('kick member', ({ roomId, targetId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const user = users.get(socket.id);
    if (!user) return;
    if (room.creatorIP !== user.ip) {
      socket.emit('system message', '你不是房主');
      return;
    }
    if (!room.members.includes(targetId) && !room.pending.includes(targetId)) return;
    const memberIdx = room.members.indexOf(targetId);
    if (memberIdx !== -1) {
      room.members.splice(memberIdx, 1);
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) {
        const targetUser = users.get(targetId);
        if (targetUser) {
          // 从批准列表中移除 IP
          const ipIndex = room.approvedIPs.indexOf(targetUser.ip);
          if (ipIndex !== -1) room.approvedIPs.splice(ipIndex, 1);
        }
        targetSocket.leave(roomId);
        targetSocket.emit('system message', `你被房主踢出 ${room.name}`);
        joinRoom(targetSocket, 'public');
      }
    }
    const pendingIdx = room.pending.indexOf(targetId);
    if (pendingIdx !== -1) {
      room.pending.splice(pendingIdx, 1);
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) {
        targetSocket.emit('system message', `你被房主拒绝加入 ${room.name}`);
      }
    }
    if (!room.blacklist.includes(targetId)) {
      room.blacklist.push(targetId);
    }
    socket.emit('system message', '已踢出并拉黑该用户');
  });

  // 房主切换审核开关
  socket.on('toggle approval', ({ roomId, requireApproval }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const user = users.get(socket.id);
    if (!user) return;
    if (room.creatorIP !== user.ip) return;
    room.requireApproval = requireApproval;
    io.to(roomId).emit('system message', `房间审核已${requireApproval ? '开启' : '关闭'}`);
    io.emit('room list', Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      requireApproval: r.requireApproval,
      memberCount: r.members.length,
      creatorId: r.creatorId,
      creatorIP: r.creatorIP,
      ownerPlaylist: r.ownerPlaylist,
      ownerPlaylistId: r.ownerPlaylistId
    })));
  });

  // 设置房间共享歌单（仅房主可调用）
  socket.on('set room playlist', ({ roomId, type, id }) => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.creatorIP !== user.ip) {
      socket.emit('system message', '只有房主可以共享歌单');
      return;
    }
    const playlist = { type, id };
    room.ownerPlaylist = playlist;
    room.ownerPlaylistId = socket.id;
    socket.to(roomId).emit('playlist changed', playlist);
  });

  // 重新连接时恢复用户信息
  socket.on('restore session', ({ nickname, avatar, lastRoomId }) => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
    }
    const newUser = { nickname, avatar, currentRoom: 'public', ip: clientIP };
    users.set(socket.id, newUser);

    // 尝试恢复到上次的房间
    if (lastRoomId && lastRoomId !== 'public') {
      const room = rooms.get(lastRoomId);
      if (room) {
        // 检查是否被拉黑（基于 IP？这里简单判断，黑名单存的是 socket.id，暂不处理）
        // 检查是否已批准（IP 在 approvedIPs 中）
        if (room.approvedIPs.includes(clientIP) || room.creatorIP === clientIP) {
          // 更新房主信息
          if (room.creatorIP === clientIP) {
            room.creatorId = socket.id;
            room.ownerPlaylistId = socket.id;
          }
          joinRoom(socket, lastRoomId);
          return;
        }
      }
    }

    // 否则加入公共大厅
    const room = rooms.get('public');
    if (room) {
      socket.join('public');
      newUser.currentRoom = 'public';
      if (!room.members.includes(socket.id)) {
        room.members.push(socket.id);
      }
    }
    socket.emit('your id', socket.id);
    socket.to('public').emit('system message', `${nickname} 重新加入了聊天室`);
    socket.emit('system message', `欢迎回来 ${nickname}！`);
    socket.emit('room changed', { roomId: 'public', roomName: '公共大厅' });
    socket.emit('room list', Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      requireApproval: r.requireApproval,
      memberCount: r.members.length,
      creatorId: r.creatorId,
      creatorIP: r.creatorIP,
      ownerPlaylist: r.ownerPlaylist,
      ownerPlaylistId: r.ownerPlaylistId
    })));
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const { nickname, currentRoom } = user;
      if (currentRoom && !currentRoom.startsWith('private:')) {
        const room = rooms.get(currentRoom);
        if (room) {
          const idx = room.members.indexOf(socket.id);
          if (idx !== -1) room.members.splice(idx, 1);
          // 房主离开时不清除 approvedIPs，以便重连
          if (room.members.length === 0 && !room.requireApproval && currentRoom !== 'public') {
            rooms.delete(currentRoom);
          }
        }
      }
      socket.to(currentRoom).emit('system message', `${nickname} 离开了聊天室`);
      users.delete(socket.id);
      console.log(`用户 ${nickname} (${socket.id}) 离开了聊天室`);
      io.emit('room list', Array.from(rooms.values()).map(r => ({
        id: r.id,
        name: r.name,
        avatar: r.avatar,
        requireApproval: r.requireApproval,
        memberCount: r.members.length,
        creatorId: r.creatorId,
        creatorIP: r.creatorIP,
        ownerPlaylist: r.ownerPlaylist,
        ownerPlaylistId: r.ownerPlaylistId
      })));
    }
  });
});

server.listen(3000, () => {
  console.log('服务器运行在 http://localhost:3000');
});
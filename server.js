import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { WebcastPushConnection } = require('tiktok-live-connector');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Инициализация Supabase для сервера
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lqjagftaeejdufwwvjwd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_6-9IBhMX9CMVbIackZAJ9g_UUk5FDqx';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- 1. ХОСТИНГ ВИДЖЕТОВ ---
// Когда OBS запрашивает ссылку вида https://твой-сайт.com/w/15?user=tiktok_name
app.get('/w/:id', async (req, res) => {
  const { id } = req.params;
  
  // Достаем HTML код виджета из базы данных
  const { data, error } = await supabase
    .from('stream_widgets')
    .select('code_content')
    .eq('id', id)
    .single();

  if (error || !data || !data.code_content) {
    return res.status(404).send('<h1>Виджет не найден</h1>');
  }

  // Отдаем сырой HTML код. OBS его отрендерит как полноценную страницу.
  res.setHeader('Content-Type', 'text/html');
  res.send(data.code_content);
});

// --- 2. TIKTOK LIVE WEB SOCKET ---
const activeTikTokStreams = new Map();

io.on('connection', (socket) => {
  socket.on('join_stream', async (tiktokUsername) => {
    if (!tiktokUsername) return;
    socket.join(tiktokUsername);

    if (activeTikTokStreams.has(tiktokUsername)) {
      const streamData = activeTikTokStreams.get(tiktokUsername);
      streamData.usersCount += 1;
      socket.emit('stream_status', { isLive: streamData.connection?.getState()?.isConnected || false });
      return;
    }

    console.log(`[TikTok] Подключаемся к: ${tiktokUsername}`);
    const tiktokLiveConnection = new WebcastPushConnection(tiktokUsername);
    activeTikTokStreams.set(tiktokUsername, { connection: tiktokLiveConnection, usersCount: 1 });

    try {
      const state = await tiktokLiveConnection.connect();
      io.to(tiktokUsername).emit('stream_status', { isLive: true, roomId: state.roomId });
    } catch (err) {
      io.to(tiktokUsername).emit('stream_status', { isLive: false, error: err.message });
    }

    tiktokLiveConnection.on('chat', data => {
      io.to(tiktokUsername).emit('chat_message', {
        userId: data.userId, nickname: data.nickname, comment: data.comment, profilePictureUrl: data.profilePictureUrl
      });
    });

    tiktokLiveConnection.on('gift', data => {
      if (data.giftType === 1 && !data.repeatEnd) return;
      io.to(tiktokUsername).emit('gift_received', {
        nickname: data.nickname, giftName: data.giftName, diamondCount: data.diamondCount, repeatCount: data.repeatCount, giftPictureUrl: data.giftPictureUrl
      });
    });

    tiktokLiveConnection.on('like', data => {
      io.to(tiktokUsername).emit('like_received', { nickname: data.nickname, likeCount: data.likeCount, totalLikes: data.totalLikeCount });
    });

    tiktokLiveConnection.on('streamEnd', () => io.to(tiktokUsername).emit('stream_status', { isLive: false }));
    tiktokLiveConnection.on('disconnected', () => io.to(tiktokUsername).emit('stream_status', { isLive: false }));
  });

  socket.on('disconnect', () => {
    // В реальном проекте тут нужно уменьшать usersCount и отключать tiktokLiveConnection
  });
});

// --- 3. ХОСТИНГ ФРОНТЕНДА (REACT) ---
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 StreamKit Server запущен на порту ${PORT}`);
});

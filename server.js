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

// Раздача статических файлов из текущей директории
app.use(express.static(__dirname));

// --- 1. РАЗДАЧА ГЛАВНОГО САЙТА (ФРОНТЕНД) ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- 2. ХОСТИНГ ВИДЖЕТОВ (ДЛЯ OBS) ---
app.get('/w/:id', async (req, res) => {
  const { id } = req.params;
  
  // Достаем HTML код виджета из базы данных
  const { data, error } = await supabase
    .from('stream_widgets')
    .select('code_content')
    .eq('id', id)
    .single();

  if (error || !data || !data.code_content) {
    return res.status(404).send('<h1 style="color:white; font-family:sans-serif; text-align:center; margin-top:20px;">Виджет не найден</h1>');
  }

  // Отдаем сырой HTML код. OBS его отрендерит как полноценную страницу.
  res.setHeader('Content-Type', 'text/html');
  res.send(data.code_content);
});

// --- 3. TIKTOK LIVE WEB SOCKET ---
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

    // --- ПЕРЕХВАТ ВСЕХ СОБЫТИЙ С ТРАНСЛЯЦИИ ---
    
    // Чат
    tiktokLiveConnection.on('chat', data => io.to(tiktokUsername).emit('chat_message', data));
    
    // Подарки (фильтруем спам от комбо)
    tiktokLiveConnection.on('gift', data => {
      if (data.giftType === 1 && !data.repeatEnd) return;
      io.to(tiktokUsername).emit('gift_received', data);
    });
    
    // Лайки
    tiktokLiveConnection.on('like', data => io.to(tiktokUsername).emit('like_received', data));
    
    // Вход зрителя на стрим
    tiktokLiveConnection.on('member', data => io.to(tiktokUsername).emit('member_join', data));
    
    // Новый подписчик (фолловер)
    tiktokLiveConnection.on('follow', data => io.to(tiktokUsername).emit('new_follower', data));
    
    // Поделились трансляцией
    tiktokLiveConnection.on('share', data => io.to(tiktokUsername).emit('stream_share', data));
    
    // Изменение количества зрителей (онлайн)
    tiktokLiveConnection.on('roomUser', data => io.to(tiktokUsername).emit('viewer_count', data));
    
    // Платная подписка (Subscribe)
    tiktokLiveConnection.on('subscribe', data => io.to(tiktokUsername).emit('new_subscribe', data));
    
    // Сундуки (Treasure Box)
    tiktokLiveConnection.on('envelope', data => io.to(tiktokUsername).emit('treasure_box', data));
    
    // Вопросы Q&A
    tiktokLiveConnection.on('question', data => io.to(tiktokUsername).emit('new_question', data));
    
    // Эмодзи в чате
    tiktokLiveConnection.on('emote', data => io.to(tiktokUsername).emit('emote_received', data));
    
    // Остальные социальные действия
    tiktokLiveConnection.on('social', data => io.to(tiktokUsername).emit('social_event', data));

    // Статусы стрима
    tiktokLiveConnection.on('streamEnd', () => io.to(tiktokUsername).emit('stream_status', { isLive: false }));
    tiktokLiveConnection.on('disconnected', () => io.to(tiktokUsername).emit('stream_status', { isLive: false }));
  });

  socket.on('disconnect', () => {
    // В реальном приложении здесь стоит добавить логику уменьшения usersCount
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 StreamKit Server запущен на порту ${PORT}`);
});

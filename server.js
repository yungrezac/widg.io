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

    // --- ПЕРЕХВАТ ВСЕХ ВОЗМОЖНЫХ СОБЫТИЙ С ТРАНСЛЯЦИИ ---
    const tiktokEvents = [
      { ttEvent: 'chat', socketEvent: 'chat_message' },
      { ttEvent: 'member', socketEvent: 'member_join' },
      { ttEvent: 'gift', socketEvent: 'gift_received' },
      { ttEvent: 'like', socketEvent: 'like_received' },
      { ttEvent: 'follow', socketEvent: 'new_follower' },
      { ttEvent: 'share', socketEvent: 'stream_share' },
      { ttEvent: 'roomUser', socketEvent: 'viewer_count' },
      { ttEvent: 'subscribe', socketEvent: 'new_subscribe' },
      { ttEvent: 'envelope', socketEvent: 'treasure_box' },
      { ttEvent: 'question', socketEvent: 'new_question' },
      { ttEvent: 'emote', socketEvent: 'emote_received' },
      { ttEvent: 'social', socketEvent: 'social_event' },
      { ttEvent: 'linkMicBattle', socketEvent: 'pk_battle' }, // Начало/обновление PK баттла
      { ttEvent: 'linkMicArmies', socketEvent: 'pk_armies' }, // Очки и участники PK баттла
      { ttEvent: 'liveIntro', socketEvent: 'live_intro' }     // Приветственное сообщение стрима
    ];

    // Динамически вешаем слушатели на все события
    tiktokEvents.forEach(({ ttEvent, socketEvent }) => {
      tiktokLiveConnection.on(ttEvent, (data) => {
        // Фильтруем спам от комбо-подарков (отправляем только итоговое значение комбо)
        if (ttEvent === 'gift' && data.giftType === 1 && !data.repeatEnd) return;
        
        // Отправляем полные, нетронутые данные прямиком в виджет!
        io.to(tiktokUsername).emit(socketEvent, data);
      });
    });

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

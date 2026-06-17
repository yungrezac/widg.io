import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

// 1. Используем современный импорт и новое имя класса TikTokLiveConnection
import { TikTokLiveConnection } from 'tiktok-live-connector';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Инициализация Supabase для сервера
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lqjagftaeejdufwwvjwd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_6-9IBhMX9CMVbIackZAJ9g_UUk5FDqx';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Глобальный перехват ошибок, чтобы сервер НИКОГДА не падал полностью
process.on('uncaughtException', (err) => {
    console.error('🔥 Критическая ошибка (uncaughtException):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 Необработанный Promise (unhandledRejection):', reason);
});

// Полный список событий
const TIKTOK_EVENTS = [
    'chat', 'gift', 'like', 'roomUser', 'member', 'social', 'follow', 'share',
    'emote', 'envelope', 'questionNew', 'linkMicBattle', 'linkMicArmies',
    'liveIntro', 'streamEnd', 'superFan', 'superFanJoin', 'superFanBox',
    'goalUpdate', 'roomMessage', 'captionMessage', 'imDelete', 'inRoomBanner',
    'rankUpdate', 'pollMessage', 'rankText', 'linkMicBattlePunishFinish',
    'linkMicBattleTask', 'linkMicFanTicketMethod', 'linkMicMethod', 
    'unauthorizedMember', 'oecLiveShopping', 'msgDetect', 'linkMessage', 
    'roomVerify', 'linkLayer', 'roomPin'
];

// --- 1. РАЗДАЧА ГЛАВНОГО САЙТА (ФРОНТЕНД) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- 2. ХОСТИНГ ВИДЖЕТОВ (ДЛЯ OBS) ---
app.get('/w/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('stream_widgets').select('code_content').eq('id', id).single();

    if (error || !data || !data.code_content) {
      return res.status(404).send('<h1 style="color:white; font-family:sans-serif; text-align:center; margin-top:20px;">Виджет не найден на widg.space</h1>');
    }

    res.setHeader('Content-Type', 'text/html');
    res.send(data.code_content);
  } catch (err) {
    console.error("Ошибка при получении виджета:", err);
    res.status(500).send('<h1 style="color:white; font-family:sans-serif; text-align:center; margin-top:20px;">Внутренняя ошибка сервера</h1>');
  }
});

// --- 3. TIKTOK LIVE WEB SOCKET ---
const activeTikTokStreams = new Map();

io.on('connection', (socket) => {
  socket.on('join_stream', async (tiktokUsername) => {
    if (!tiktokUsername) return;
    socket.join(tiktokUsername);

    // Если мы уже слушаем этого стримера
    if (activeTikTokStreams.has(tiktokUsername)) {
      const streamData = activeTikTokStreams.get(tiktokUsername);
      streamData.usersCount += 1;
      
      // Отправляем статус с кешированным значением подписчиков
      socket.emit('stream_status', { 
          isLive: streamData.connection?.getState()?.isConnected || false,
          followerCount: streamData.lastFollowerCount || 0
      });
      return;
    }

    console.log(`[TikTok] Подключаемся к: ${tiktokUsername}`);
    const connection = new TikTokLiveConnection(tiktokUsername, {
      processInitialData: true,
      enableExtendedGiftInfo: false // <--- МЕНЯЕМ TRUE НА FALSE ЗДЕСЬ
    });
    
    activeTikTokStreams.set(tiktokUsername, { connection, usersCount: 1, lastFollowerCount: 0 });

    // ВАЖНО: Добавляем обработчик ошибок, чтобы сервер не падал с 502 ошибкой
    connection.on('error', (err) => {
        console.error(`[TikTok Error - ${tiktokUsername}]:`, err);
    });

    TIKTOK_EVENTS.forEach(eventName => {
        connection.on(eventName, (data) => {
            io.to(tiktokUsername).emit(eventName, data);
        });
    });

    connection.on('streamEnd', () => io.to(tiktokUsername).emit('stream_status', { isLive: false }));
    connection.on('disconnected', () => {
        io.to(tiktokUsername).emit('stream_status', { isLive: false });
        activeTikTokStreams.delete(tiktokUsername); 
    });

    try {
      const state = await connection.connect();
      
      const followerCount = state.roomInfo?.owner?.followInfo?.followerCount || 
                            state.roomInfo?.owner?.follow_info?.follower_count || 0;
                            
      console.log(`[TikTok] Успешно! Стример ${tiktokUsername}. Подписчиков: ${followerCount}`);
                            
      const streamData = activeTikTokStreams.get(tiktokUsername);
      if (streamData) streamData.lastFollowerCount = followerCount;

      io.to(tiktokUsername).emit('stream_status', { 
          isLive: true, 
          roomId: state.roomId,
          followerCount: followerCount 
      });
    } catch (err) {
      console.error(`[TikTok Connect Error - ${tiktokUsername}]:`, err.message);
      io.to(tiktokUsername).emit('stream_status', { isLive: false, error: err.message });
      activeTikTokStreams.delete(tiktokUsername);
    }
  });

  socket.on('disconnect', () => {
    // Логика отключения
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 widg.space Server запущен на порту ${PORT}`);
});

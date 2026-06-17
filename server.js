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

// Инициализация Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lqjagftaeejdufwwvjwd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_6-9IBhMX9CMVbIackZAJ9g_UUk5FDqx';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// Раздача статики
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

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

// --- 1. ХОСТИНГ ВИДЖЕТОВ (ДЛЯ OBS) ---
app.get('/w/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
      console.log(`[GET /w/${id}] Запрос кода виджета...`);
      
      const { data, error } = await supabase
        .from('stream_widgets')
        .select('code_content')
        .eq('id', id)
        .single();

      if (error) {
          console.error(`[DB Error] Ошибка БД при поиске виджета ${id}:`, error.message);
          return res.status(404).send(`
              <body style="background:#0e1621; color:#ef4444; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; flex-direction:column;">
                  <h2>Ошибка Базы Данных</h2>
                  <p>${error.message}</p>
              </body>
          `);
      }

      if (!data || !data.code_content) {
          console.error(`[Not Found] Виджет ${id} не найден или его код пуст.`);
          return res.status(404).send(`
              <body style="background:#0e1621; color:white; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; flex-direction:column;">
                  <h2>Виджет не найден (404)</h2>
                  <p style="color:#a8b8c8;">Возможно, он был удален или ID указан неверно.</p>
              </body>
          `);
      }

      console.log(`[GET /w/${id}] Успешно отдан HTML код.`);
      res.setHeader('Content-Type', 'text/html');
      res.send(data.code_content);
      
  } catch (err) {
      console.error(`[Server Error] Маршрут /w/${id}:`, err);
      res.status(500).send("Внутренняя ошибка сервера");
  }
});

// --- 2. РАЗДАЧА ГЛАВНОГО САЙТА (ФРОНТЕНД) ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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
    const connection = new WebcastPushConnection(tiktokUsername, {
      processInitialData: true,
      enableExtendedGiftInfo: true
    });
    
    activeTikTokStreams.set(tiktokUsername, { connection, usersCount: 1 });

    TIKTOK_EVENTS.forEach(eventName => {
        connection.on(eventName, (data) => {
            io.to(tiktokUsername).emit(eventName, data);
        });
    });

    connection.on('streamEnd', () => io.to(tiktokUsername).emit('stream_status', { isLive: false }));
    connection.on('disconnected', () => io.to(tiktokUsername).emit('stream_status', { isLive: false }));
    
    // ВАЖНО: Перехватываем ошибки коннектора, чтобы сервер не падал (исправление ошибки 502)
    connection.on('error', (err) => {
        console.error(`[TikTok Error] Ошибка соединения у ${tiktokUsername}:`, err.message);
    });

    try {
      const state = await connection.connect();
      io.to(tiktokUsername).emit('stream_status', { isLive: true, roomId: state.roomId });
    } catch (err) {
      io.to(tiktokUsername).emit('stream_status', { isLive: false, error: err.message });
    }
  });

  socket.on('disconnect', () => {
    // Логика отключения
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 widg.space Server запущен на порту ${PORT}`);
});

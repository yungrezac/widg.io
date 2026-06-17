import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { TikTokLiveConnection } from 'tiktok-live-connector';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lqjagftaeejdufwwvjwd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_6-9IBhMX9CMVbIackZAJ9g_UUk5FDqx';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

process.on('uncaughtException', (err) => console.error('🔥 Критическая ошибка:', err));
process.on('unhandledRejection', (reason) => console.error('🔥 Необработанный Promise:', reason));

const TIKTOK_EVENTS = ['chat', 'gift', 'like', 'member', 'follow', 'share', 'streamEnd'];

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/w/:id', async (req, res) => {
  const { id } = req.params;
  const { data } = await supabase.from('stream_widgets').select('code_content').eq('id', id).single();
  if (!data) return res.status(404).send('Виджет не найден');
  res.send(data.code_content);
});

const activeTikTokStreams = new Map();

io.on('connection', (socket) => {
  socket.on('join_stream', async (tiktokUsername) => {
    if (!tiktokUsername) return;
    socket.join(tiktokUsername);

    if (activeTikTokStreams.has(tiktokUsername)) {
      const streamData = activeTikTokStreams.get(tiktokUsername);
      streamData.usersCount += 1;
      
      socket.emit('stream_status', { 
          isLive: streamData.connection.isConnected, // Исправлено: свойство вместо функции
          followerCount: streamData.lastFollowerCount || 0
      });
      return;
    }

    const connection = new TikTokLiveConnection(tiktokUsername, {
      processInitialData: true,
      enableExtendedGiftInfo: false
    });
    
    activeTikTokStreams.set(tiktokUsername, { connection, usersCount: 1, lastFollowerCount: 0 });

    TIKTOK_EVENTS.forEach(eventName => {
        connection.on(eventName, (data) => io.to(tiktokUsername).emit(eventName, data));
    });

    try {
      const state = await connection.connect();
      
      // TikTok часто отдает подписчиков в этих полях, если они есть
      const followerCount = state.roomInfo?.owner?.followInfo?.followerCount || 0;
                            
      const streamData = activeTikTokStreams.get(tiktokUsername);
      if (streamData) streamData.lastFollowerCount = followerCount;

      io.to(tiktokUsername).emit('stream_status', { 
          isLive: true, 
          followerCount: followerCount 
      });
    } catch (err) {
      console.error(`Ошибка подключения: ${err.message}`);
      activeTikTokStreams.delete(tiktokUsername);
    }
  });
});

server.listen(process.env.PORT || 3000, '0.0.0.0');

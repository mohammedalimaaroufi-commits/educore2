require('dotenv').config();



const path = require('path');

const express = require('express');

const cors = require('cors');

const http = require('http');

const { Server } = require('socket.io');

const jwt = require('jsonwebtoken');



const authRoutes = require('./routes/auth');

const classesRoutes = require('./routes/classes');

const studentsRoutes = require('./routes/students');

const gradesRoutes = require('./routes/grades');

const behaviorRoutes = require('./routes/behavior');

const attendanceRoutes = require('./routes/attendance');

const reportsRoutes = require('./routes/reports');

const schemesRoutes = require('./routes/schemes');

const settingsRoutes = require('./routes/settings');

const adminRoutes = require('./routes/admin');

const messagesRoutes = require('./routes/messages');

const backupRoutes = require('./routes/backup');
const syncRoutes = require('./routes/sync');



const app = express();
const BUILD_VERSION = process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || 'ca0a49f';

app.use(cors());

app.use(express.json({ limit: '5mb' }));



app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  name: 'EduCore Manager API',
  database: process.env.LIBSQL_URL ? 'turso' : 'sqlite',
  build: BUILD_VERSION,
}));



app.use('/api/auth', authRoutes);

app.use('/api/classes', classesRoutes);

app.use('/api/students', studentsRoutes);

app.use('/api/grades', gradesRoutes);

app.use('/api/behavior', behaviorRoutes);

app.use('/api/attendance', attendanceRoutes);

app.use('/api/reports', reportsRoutes);

app.use('/api/schemes', schemesRoutes);

app.use('/api/settings', settingsRoutes);

app.use('/api/admin', adminRoutes);

app.use('/api/messages', messagesRoutes);

app.use('/api/backup', backupRoutes);
app.use('/api/sync', syncRoutes);



// Serve the production frontend from the same Render service and domain.

const frontendDist = path.join(__dirname, '../../frontend/dist');

app.use(express.static(frontendDist));

app.get('*', (req, res, next) => {
  
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    
    if (err) next(err);
    
  });
  
});



app.use((err, req, res, next) => {
  // Browsers and mobile networks can cancel requests while navigating or
  // waking from sleep. Do not turn those cancellations into noisy 500s.
  if (err?.code === 'ECONNABORTED' || req.destroyed || res.headersSent) {
    if (res.headersSent) return next(err);
    return;
  }

  console.error('Unhandled request error:', err);
  if (!res.headersSent) res.status(500).json({ error: 'حدث خطأ في الخادم' });
});



const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: false,
  },
  pingInterval: 25000,
  pingTimeout: 20000,
});

app.set('io', io);



const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';



// Real-time chat: each teacher has a private room `chat:{teacherId}`.

io.use((socket, next) => {
  
  const token = socket.handshake.auth?.token;
  
  if (!token) return next(new Error('unauthorized'));
  
  try {
    
    socket.user = jwt.verify(token, JWT_SECRET);
    
    next();
    
  } catch (err) {
    
    next(new Error('unauthorized'));
    
  }
  
});



io.on('connection', (socket) => {
  
  if (socket.user.role === 'admin') {
    
    socket.join('admin');
    
    socket.on('join_conversation', (teacherId) => {
      
      if (teacherId) socket.join(`chat:${teacherId}`);
      
    });
    
  } else if (socket.user.id) {
    
    socket.join(`chat:${socket.user.id}`);
    
  }
  
});



const PORT = process.env.PORT || 4000;

server.listen(PORT, '0.0.0.0', () => {
  
  console.log(`EduCore Manager API running on http://localhost:${PORT}`);
  
});






























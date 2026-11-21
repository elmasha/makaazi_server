const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const redisClient = require('./config/redis');

const app = express();

// Railway sits behind a proxy — needed for correct IP/protocol detection
app.set('trust proxy', 1);

// --- CORS: must be the very first middleware ---
const allowedOrigins = [
  'https://makaazi.netlify.app',
  'http://localhost:3000',
  'http://127.0.0.1:4000',
  // add your production frontend origin(s) here, e.g.:
  // 'https://app.yourdomain.com',
];

const corsOptions = {
  origin: (origin, callback) => {
    // allow non-browser requests (curl, Postman, server-to-server) with no origin
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 86400, // cache preflight for 24h
};

app.use(cors(corsOptions));
// Explicitly answer preflight for every route (belt-and-braces)
app.options('*', cors(corsOptions));

// --- Body parsing ---
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// --- Request logging ---
app.use((req, res, next) => {
  console.log(`Incoming: ${req.method} ${req.originalUrl} | Origin: ${req.headers.origin || 'none'}`);
  next();
});

// --- Health / test route ---
app.get('/', (req, res) => {
  res.send('Welcome to Makaazi Estate Management API');
});

// --- Dev-only routes ---
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/dev', require('./routes/dev'));
}

// --- Application routes ---
app.use('/payment/', require('./payments/mpesaStkPush'));
app.use('/api/roles', require('./routes/roles'));
app.use('/api/estates', require('./routes/estates'));
app.use('/api/estates-config', require('./routes/estatesConfig'));
app.use('/api/charts', require('./routes/charts'));
app.use('/api/officials', require('./routes/officials'));
app.use('/api/households', require('./routes/households'));
app.use('/api/workers', require('./routes/workers'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/sections', require('./routes/sections'));
app.use('/api/arrears', require('./routes/arrears'));
app.use('/api/receipts', require('./routes/receipts'));
app.use('/api/visitor-logs', require('./routes/visitorLogs'));
app.use('/api/incident-types', require('./routes/incidentTypes'));
app.use('/api/cash-routing', require('./routes/cashRouting'));
app.use('/api/audit-logs', require('./routes/auditLogs'));
app.use('/api/services', require('./routes/serviceCharges'));
app.use('/api/fcm', require('./routes/fcm'));
app.use('/api/household-payments', require('./routes/householdPayments'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/visitor-passes', require('./routes/visitors'));

// --- 404 handler (still returns CORS headers, so browser shows a real 404, not a CORS error) ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// --- Global error handler (also preserves CORS headers) ---
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err.message && err.message.startsWith('CORS blocked')) {
    return res.status(403).json({ error: err.message });
  }
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// --- Start server ---
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Makaazi Server running on http://localhost:${PORT}`);
});

// --- Graceful shutdown ---
const shutdown = (signal) => {
  console.log(`${signal} received, closing server...`);
  server.close(() => {
    console.log('HTTP server closed.');
    if (redisClient && typeof redisClient.quit === 'function') {
      redisClient.quit().finally(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// --- Catch crashes so Railway logs them clearly instead of serving a header-less error page ---
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // keep process alive briefly so logs flush, then let Railway restart
  setTimeout(() => process.exit(1), 1000);
});

module.exports = app;
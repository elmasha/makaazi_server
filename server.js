const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const redisClient = require('./config/redis');

const app = express();

// Railway sits behind a proxy — needed for correct IP/protocol detection
app.set('trust proxy', 1);

// --- CORS CONFIGURATION ---
const allowedOrigins = [
  'https://makaazi.netlify.app',
  'http://localhost:4000',
  'http://localhost:3000',
  'http://127.0.0.1:4000',
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, or Postman)
    if (!origin) return callback(null, true);
    
    // Check if the origin is in our allowed list
    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('netlify.app')) {
      callback(null, true);
    } else {
      console.error(`🚫 CORS blocked for origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 86400, // Cache preflight for 24 hours
};

// Apply CORS middleware to ALL routes
app.use(cors(corsOptions));

// Explicitly handle preflight OPTIONS requests for all routes
app.options('*', cors(corsOptions));

// --- BODY PARSING ---
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// --- REQUEST LOGGING ---
app.use((req, res, next) => {
  console.log(`Incoming: ${req.method} ${req.originalUrl} | Origin: ${req.headers.origin || 'none'}`);
  next();
});

// --- HEALTH / TEST ROUTE ---
app.get('/', (req, res) => {
  res.send('Welcome to Makaazi Estate Management API');
});

// --- DEV ROUTES ---
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/dev', require('./routes/dev'));
}

// --- APPLICATION ROUTES ---
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

// --- 404 HANDLER ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: err.message });
  }
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// --- START SERVER ---
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Makaazi Server running on http://localhost:${PORT}`);
});

// --- GRACEFUL SHUTDOWN ---
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

// --- CRASH HANDLING ---
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  setTimeout(() => process.exit(1), 1000);
});

module.exports = app;
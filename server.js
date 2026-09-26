const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const redisClient = require('./config/redis');
const app = express();
require('dotenv').config();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use((req, res, next) => {
  console.log("Incoming:", req.method, req.url);
  next();
});
// Test Redis Connection
// Test Redis Connection at Startup



// Test Route
app.get('/', (req, res) => {
  
  res.send('Welcome to Makaazi Estate Management API');
});

// Import Routes
app.use('/payment/', require('./payments/mpesaStkPush'))
app.use('/api/roles', require('./routes/roles'));
app.use('/api/estates', require('./routes/estates'));
app.use('/api/estates-config', require('./routes/estatesConfig'));
app.use('/api/charts', require('./routes/charts'));
app.use('/api/officials', require('./routes/officials'));
app.use('/api/households', require('./routes/households'));
app.use('/api/workers', require('./routes/workers'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/visitors', require('./routes/visitors'));
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
app.use("/api/fcm",  require("./routes/fcm"));
app.use("/api/household-payments", require('./routes/householdPayments'));
// Start the Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Makaazi Server running on http://localhost:${PORT}`);
});

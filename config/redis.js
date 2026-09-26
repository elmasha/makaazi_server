const { createClient } = require('redis');
require('dotenv').config();

// Create Redis client using REDIS_URL (from Railway)
const client = createClient({
  url: process.env.REDIS_URL,  // use full URL
});

// Event: Connected...
client.on('connect', () => {
  console.log('✅ Redis connected successfully');
});

// Event: Error
client.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

// Connect and test
(async () => {
  try {
    await client.connect();
    const pong = await client.ping();
    console.log('✅ Redis PING:', pong); // Should print "PONG"
  } catch (err) {
    console.error('❌ Redis error:', err.message);
  }
})();

// Export client
module.exports = client;





























// const redis = require('redis');
// require('dotenv').config();

// let client;

//     client = redis.createClient({
//         host: process.env.REDIS_HOST  ,
//         port: process.env.REDIS_PORT  ,
//     });

// client.on('connect', () => {
//     console.log('✅ Redis connected successfully');
    
// });

// client.on('error', (err) => {
//     if(err){
//         return  console.error('❌ Redis connection error:', err.message);
//     }
   
// });

// // client.connect(); // <-- REQUIRED for redis@4+
// client.connect()
//     .then(() => {
//         console.log('✅ Redis connected');
//         return client.ping();
//     })
//     .then((response) => {
//         console.log('✅ Redis PING:', response);  // Should print "PONG"
//     })
//     .catch((err) => {
//         console.error('Redis error:', err.message);
//     });



// // Avoid closing the client immediately
// // client.quit();  <-- Do not use this here

// module.exports = client;

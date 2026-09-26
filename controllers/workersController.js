const db = require('../config/db');
const redisClient = require('../config/redis');

const DEFAULT_EXPIRATION = 60;

// Get all workers with Redis caching
exports.getAllWorkers = async (req, res) => {
    // Construct a unique cache key for all workers
    const cacheKey = `workers`;

    try {
        // Step 1: Check if the data is cached
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving all workers from Redis cache');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // Step 2: If not cached, query the database
        const sql = 'SELECT * FROM workers';
        db.query(sql, async (err, results) => {
            if (err) {
                console.error("❌ Database error:", err.message);
                return res.status(500).json({ error: err.message });
            }

            // Step 3: Cache the results with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
            console.log('💾 Cached all workers data');

            res.json(results);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// Create worker
exports.addWorker = (req, res) => {
    const { estate_id,full_name, role, contact_number, uid } = req.body;

    const sql = `
        INSERT INTO workers ( estate_id , full_name,  role, contact_number,uid)
        VALUES (?,?,?,?,?);
    `;
    const data = [ estate_id,full_name,role, contact_number,  uid];

    db.query(sql, data, (err, result) => {
        if (err) {
            console.error("❌ Error adding worker:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'worker added successfully', workerId: result.insertId });
    });
};



// Get worker by contact number with Redis caching
exports.getWorkerByEstate = async (req, res) => {
    const estate_id = req.params.id;

    // Construct a unique cache key using the worker's contact number
    const cacheKey = `getworker/:${estate_id}`;

    try {
        // Step 1: Check if the data is cached
        const cachedResult = await redisClient.get(cacheKey);
        if (cachedResult) {
            console.log('🔁 Serving from Redis cache');
            return res.status(200).json(JSON.parse(cachedResult));
        }

        // Step 2: If not cached, query the database
        const sql = `SELECT * FROM workers WHERE estate_id = ?`;
        db.query(sql, [estate_id], async (err, results) => {
            if (err) {
                console.error("❌ Database Error:", err.message);
                return res.status(500).send("Error retrieving worker");
            }

            if (results.length === 0) {
                return res.status(404).send("worker not found");
            }

            // Step 3: Cache the result with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
            console.log('💾 Cached worker data by ID');

           return res.status(200).json(results);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        return  res.status(500).json({ error: 'Server error' });
    }
};


// Get worker by contact number with Redis caching
exports.getWorkerById = async (req, res) => {
    const uid = req.params.uid;

    // Construct a unique cache key using the worker's contact number
    const cacheKey = `getworker/:${uid}`;

    try {
        // Step 1: Check if the data is cached
        const cachedResult = await redisClient.get(cacheKey);
        if (cachedResult) {
            console.log('🔁 Serving from Redis cache');
            return res.status(200).json(JSON.parse(cachedResult));
        }

        // Step 2: If not cached, query the database
        const sql = `SELECT * FROM workers WHERE uid = ?`;
        db.query(sql, [uid], async (err, results) => {
            if (err) {
                console.error("❌ Database Error:", err.message);
                return res.status(500).send("Error retrieving worker");
            }

            if (results.length === 0) {
                return res.status(404).send("worker not found");
            }

            // Step 3: Cache the result with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(results[0]));
            console.log('💾 Cached worker data by ID');

           return res.status(200).json(results[0]);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        return  res.status(500).json({ error: 'Server error' });
    }
};

// Search workers with Redis caching
exports.searchWorkers = async (req, res) => {
    const { query } = req.query; // Retrieve the search query from the client

    if (!query) {
        return res.status(400).send("Search query is required");
    }

    // Construct a unique cache key using the search query
    const cacheKey = `search:workers:${query}`;

    try {
        // Step 1: Check if the search results are cached
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving search results from Redis cache');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // Step 2: If not cached, perform a full-text search in the database
        let sql = `
            SELECT full_name, role, contact_number
            FROM workers
            WHERE MATCH(full_name, role, contact_number) AGAINST(? IN NATURAL LANGUAGE MODE)
        `;
        db.query(sql, query, async (err, results) => {
            if (err) {
                console.error('❌ Error searching workers:', err);
                return res.status(500).send("Error searching workers");
            }

            // Step 3: Cache the results in Redis with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
            console.log('💾 Search results cached');

            res.status(200).json(results);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};


exports.searchEstateWorkers = async (req, res) => {
    const { query, estate_id } = req.query;

    if (!query || !estate_id) {
        return res.status(400).send("Both search query and estate_id are required");
    }

    const cacheKey = `search:workers:estate:${estate_id}:q:${query}`;

    try {
        // Check Redis cache
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            console.log("🔁 Returning cached search results");
            return res.status(200).json(JSON.parse(cached));
        }

        // Perform full-text search filtered by estate_id
        const sql = `
            SELECT full_name, role, contact_number
            FROM workers
            WHERE estate_id = ?
              AND MATCH(full_name, role, contact_number) AGAINST(? IN NATURAL LANGUAGE MODE)
        `;

        db.query(sql, [estate_id, query], async (err, results) => {
            if (err) {
                console.error("❌ DB Error:", err.message);
                return res.status(500).send("Error searching workers");
            }

            await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
            console.log("✅ Search results cached");

            res.status(200).json(results);
        });
    } catch (error) {
        console.error("❌ Redis error:", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
};



///.......Update worker......////
exports.updateWorker = (req, res) => {
    const workerId = req.params.id;
    const fields = req.body;

    // Check if the ID is provided
    if (!workerId) {
        return res.status(400).json({ error: "worker ID is required" });
    }
    // Check if there are fields to update
    if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
    }
    // Build dynamic SQL query and values array
    let sql = "UPDATE workers SET ";
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
        sql += `${key} = ?, `;
        values.push(value);
    }
    // Remove the last comma and space
    sql = sql.slice(0, -2);

    // Add the WHERE clause
    sql += " WHERE worker_id = ?";
    values.push(workerId);

    // Execute the query
    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).json({ error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "worker not found" });
        }

        res.json({ message: "worker updated successfully" });
    });
};

////.......Delete worker...../////
exports.deleteWorker = (req, res) => {
    const contact_number = req.params.id;

    const sql = `DELETE FROM workers WHERE contact_number = ?`;

    db.query(sql, [contact_number], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'worker not found' });
        }

        res.json({ message: 'worker deleted successfully' });
    });
};

////.......worker worker...../////
exports.existingWorker = (req,res) =>{
    const phone = req.params.phone;
    const query = "SELECT 1 FROM  workers WHERE contact_number = ?";
    db.query(query, [phone], (err, results) => {
      if (err) {
        console.error("Error executing query:", err);
        return res.status(500).send("Internal Server Error");
      }
  
      if (results.length > 0) {
        res.send({ exists: true, message: `UID ${phone} exists.` });
      } else {
        res.send({ exists: false, message: `UID ${phone} does not exist.` });
      }
    });

};





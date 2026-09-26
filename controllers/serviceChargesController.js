const db = require('../config/db');
const redisClient = require('../config/redis');


// Get All Charges
// Get all service charges with Redis caching
exports.getAllCharges = async (req, res) => {
    // Construct a unique cache key for all charges
    const cacheKey = `charges`;

    try {
        // Step 1: Check if the data is cached
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving all charges from Redis cache');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // Step 2: If not cached, query the database
        const sql = 'SELECT * FROM service_charges';
        db.query(sql, async (err, results) => {
            if (err) {
                console.error("❌ Database error:", err.message);
                return res.status(500).json({ error: err.message });
            }

            // Step 3: Cache the results with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
            console.log('💾 Cached all charges data');

            res.json(results);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};



// Get estate service charges  with Redis caching
exports.getEstateServiceCharges = async (req, res) => {
    const id = req.params.id;

    // Construct a unique cache key for all charges
       const cacheKey = `service_charges/:${id}`;
   
       try {
           // Step 1: Check if the data is cached
           const cachedResult = await redisClient.get(cacheKey);
           if (cachedResult) {
               console.log('🔁 Serving from Redis cache',cachedResult);
               return res.status(200).json(JSON.parse(cachedResult));
           }
   
           // Step 2: If not cached, query the database
           const sql = `SELECT * FROM service_charges WHERE estate_id = ?`;
           db.query(sql, [id], async (err, results) => {
               if (err) {
                   console.error("❌ Database Error:", err.message);
                   return res.status(500).send("Error retrieving official");
               }

               if (results.length === 0) {
                   return res.status(404).send("service_charges not found");
               }
   
               // Step 3: Cache the result with a 5-minute expiration
               await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
               console.log('💾 Cached service_charges data by ID',results);
   
              return res.status(200).json(results);
           });
       } catch (error) {
           console.error('❌ Redis error:', error.message);
           return  res.status(500).json({ error: 'Server error' });
       }
};



// Add Service Charge
exports.addCharge = (req, res) => {
    const {estate_id, charge_type, frequency, amount } = req.body;
    const sql = 'INSERT INTO service_charges (estate_id, charge_type, frequency, amount ) VALUES (?, ?, ?, ?)';
    db.query(sql, [estate_id, charge_type, frequency, amount ], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Service charge added successfully', estate_id: result.insertId });
    });
};


///.......Update charges......////
exports.updateCharges = (req, res) => {
    const chargesId = req.params.id;
    const fields = req.body;

    // Check if the ID is provided
    if (!chargesId) {
        return res.status(400).json({ error: "charges ID is required" });
    }
    // Check if there are fields to update
    if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
    }
    // Build dynamic SQL query and values array
    let sql = "UPDATE service_charges SET ";
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
        sql += `${key} = ?, `;
        values.push(value);
    }
    // Remove the last comma and space
    sql = sql.slice(0, -2);

    // Add the WHERE clause
    sql += " WHERE charges_id = ?";
    values.push(chargesId);

    // Execute the query
    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).json({ error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "charges not found" });
        }

        res.json({ message: "charges updated successfully" });
    });
};


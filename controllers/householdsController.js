const db = require('../config/db');
const redisClient = require('../config/redis');

const DEFAULT_EXPIRATION = 60;

exports.getHouseholdsByAddress = async (req, res) => {
    const { estate_id, section, street, court } = req.query;

    if (!estate_id) {
        return res.status(400).json({ error: "estate_id is required" });
    }

    // Redis cache key
    const cacheKey = `households:${estate_id}:${section || "all"}:${street || "all"}:${court || "all"}`;

    try {
        // 1️⃣ Check Redis first
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.json(JSON.parse(cached));
        }

        // 2️⃣ Build query
        let conditions = ["estate_id = ?"];
        let values = [estate_id];

        if (section) {
            conditions.push("section = ?");
            values.push(section);
        }
        if (street) {
            conditions.push("street = ?");
            values.push(street);
        }
        if (court) {
            conditions.push("court = ?");
            values.push(court);
        }

        const sql = `
            SELECT
                household_id,
                uid,
                primary_owner,
                contact_number,
                house_number,
                section,
                street,
                court,
                active
            FROM households
            WHERE ${conditions.join(" AND ")}
            ORDER BY section, street, court, house_number
        `;

        const [rows] = await db.promise().query(sql, values);

        // 3️⃣ Save to Redis for 10 minutes
        await redisClient.setEx(cacheKey, 200, JSON.stringify(rows));

        return res.json(rows);
    } catch (err) {
        console.error("Households by address error:", err.message);
        return res.status(500).json({ error: "Failed to fetch households" });
    }
};

// ✅ Get All Households
exports.getAllHouseholds = async(req, res) => {
    const cacheKey = `households`;
    try {
         // Try to get data from Redis
        const cachedData =  await redisClient.get(cacheKey);
        if (cachedData) {
            console.log('🔁 Serving from cache');
            return res.json(JSON.parse(cachedData));
        }else{
            const sql = 'SELECT * FROM households ORDER BY created_at DESC';
            db.query(sql,  async(err, results) => {

                if (err) {
                    console.error('❌ Error getting households:', err);
                    return res.status(500).send("Error getting households:");
                }
                // Cache the results in Redis with an expiration of 1 minute
                await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
                console.log('💾 Search results cached');
                res.status(200).json(results);

            });

        }       
    } catch (error) {
        console.error('❌ Redis error:', error);
        res.status(500).send("Server error");
    }


   
};

// Get household by ID with Redis caching
exports.getHouseholdById = async (req, res) => {
    const { id } = req.params;

    // Construct a unique cache key using the household ID
    const cacheKey = `getHousehold:${id}`;

    try {
        // Step 1: Check if the data is cached
        const cachedResult = await redisClient.get(cacheKey);
        if (cachedResult) {
            console.log('🔁 Serving from Redis cache');
            return res.status(200).json(JSON.parse(cachedResult));
        }

        // Step 2: If not cached, query the database
        const sql = 'SELECT * FROM households WHERE uid = ? ORDER BY created_at DESC';
        db.query(sql, [id], async (err, result) => {
            if (err) {
                console.error('❌ Database error:', err.message);
                return res.status(500).json({ error: err.message });
            }

            if (result.length === 0) {
                return res.status(404).json({ message: 'Household not found' });
            }

            // Step 3: Cache the result with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(result[0]));
            console.log('💾 Cached household data by ID');

            res.json(result[0]);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};



exports.getHouseholdId = async (req, res) => {
    const { id } = req.params;

    // Construct a unique cache key using the household ID
    const cacheKey = `getHousehold:${id}`;

    try {
        // Step 1: Check if the data is cached
        const cachedResult = await redisClient.get(cacheKey);
        if (cachedResult) {
            console.log('🔁 Serving from Redis cache');
            return res.status(200).json(JSON.parse(cachedResult));
        }

        // Step 2: If not cached, query the database
        const sql = 'SELECT * FROM households WHERE household_id = ? ORDER BY created_at DESC';
        db.query(sql, [id], async (err, result) => {
            if (err) {
                console.error('❌ Database error:', err.message);
                return res.status(500).json({ error: err.message });
            }

            if (result.length === 0) {
                return res.status(404).json({ message: 'Household not found' });
            }

            // Step 3: Cache the result with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(result[0]));
            console.log('💾 Cached household data by ID');

            res.json(result[0]);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};




// Get household by ID with Redis caching
exports.getHouseholdByPhone = async (req, res) => {
    const { contact_number } = req.params;

    // Construct a unique cache key using the household ID
    const cacheKey = `getHouseholdPhone:${contact_number}`;

    try {
        // Step 1: Check if the data is cached
        const cachedResult = await redisClient.get(cacheKey);
        if (cachedResult) {
            console.log('🔁 Serving from Redis cache');
            return res.status(200).json(JSON.parse(cachedResult));
        }

        // Step 2: If not cached, query the database
        const sql = 'SELECT * FROM households WHERE contact_number = ? ORDER BY created_at DESC';
        db.query(sql, [contact_number], async (err, result) => {
            if (err) {
                console.error('❌ Database error:', err.message);
                return res.status(500).json({ error: err.message });
            }

            if (result.length === 0) {
                return res.status(404).json({ message: 'Household not found' });
            }

            // Step 3: Cache the result with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(result[0]));
            console.log('💾 Cached household data by contact number');

            res.json(result[0]);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};


// Search households by estate ID and keyword
exports.searchHouseholdsId = async (req, res) => {
    const id = req.params.id;
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
    }

    const cacheKey = `search:households:${id}:${query}`;

    try {
        // Check Redis cache for the search results
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving search results from cache\n');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // SQL query to search within the specified estate ID
        const sql = `
            SELECT * FROM households 
            WHERE estate_id = ? AND (
                primary_owner LIKE ? OR
                contact_number LIKE ? OR
                house_number LIKE ?
            )
        `;
        const searchPattern = `%${query}%`;

        db.query(sql, [id, searchPattern, searchPattern, searchPattern], async (err, results) => {
            if (err) {
                console.error('Database error: ' + err.message);
                return res.status(500).json({ error: 'Database error' });
            }

            // Cache the results in Redis with a 5-minute expiration
            await redisClient.setEx(cacheKey, 3000, JSON.stringify(results));
            console.log('💾 Search results cached');
            return res.status(200).json(results);
           
        })
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        return res.status(500).json({ error: 'Server error' });
    }
};

// Search households by keyword
// Search households by keyword with Redis caching
exports.searchHouseholds = async (req, res) => {
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ error: 'Search query is required' });
    }

    // Construct a unique cache key using the search query
    const cacheKey = `search:households:${query}`;

    try {
        // Step 1: Check if the search results are cached
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving from cache');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // Step 2: If not cached, query the database
        const sql = `
            SELECT * FROM households 
            WHERE primary_owner LIKE ? OR contact_number LIKE ? OR house_number LIKE ?
        `;
        const searchPattern = `%${query}%`;

        db.query(sql, [searchPattern, searchPattern, searchPattern], async (err, results) => {
            if (err) {
                console.error('❌ Database error: ' + err.message);
                return res.status(500).json({ error: 'Database error' });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: 'No matching households found' });
            }

            // Step 3: Cache the results with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
            console.log('💾 Cached search results');

            res.json(results);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};


// ✅ Get a Single Household by ID
// Get active households by estate ID with Redis caching
exports.getActiveHouseHolds = async (req, res) => {
    const { active } = req.params;

    if (!active) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    // Construct a unique cache key using active status and estate ID
    const cacheKey = `getActiveHouseHolds/:${active}:`;

    try {
        // Step 1: Check if the data is cached
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving from Redis cache');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // Step 2: If not cached, query the database
        const sql = 'SELECT * FROM households WHERE active = ? ORDER BY created_at DESC';
        db.query(sql, [active], async (err, result) => {
            if (err) {
                console.error('❌ Database error:', err.message);
                return res.status(500).json({ error: err.message });
            }

            if (result.length === 0) {
                return res.status(404).json({ message: 'Household not found' });
            }

            // Step 3: Cache the result with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
            console.log('💾 Cached active households data');

            res.json(result);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};


// ✅ Get a Single Household by ID
// Get active households by estate ID with Redis caching
exports.getOfficials = async (req, res) => {
    const { is_official } = req.params;

    if (!is_official) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    // Construct a unique cache key using is_official status and estate ID
    const cacheKey = `getOfficials/:${is_official}`;

    try {
        // Step 1: Check if the data is cached
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving from Redis cache');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // Step 2: If not cached, query the database
        const sql = 'SELECT * FROM households WHERE is_official = ? ORDER BY created_at DESC';
        db.query(sql, [is_official], async (err, result) => {
            if (err) {
                console.error('❌ Database error:', err.message);
                return res.status(500).json({ error: err.message });
            }

            if (result.length === 0) {
                return res.status(404).json({ message: 'Household not found' });
            }

            // Step 3: Cache the result with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
            console.log('💾 Cached active households data');

            res.json(result);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};


// ✅ Get a Single Household by ID
// Get active households by estate ID with Redis caching
exports.getActiveEstate = async (req, res) => {
    const { active, estate_id } = req.params;

    if (!active || !estate_id) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    // Construct a unique cache key using active status and estate ID
    const cacheKey = `active:households:${active}:${estate_id}`;

    try {
        // Step 1: Check if the data is cached
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving from Redis cache');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // Step 2: If not cached, query the database
        const sql = 'SELECT * FROM households WHERE active = ? AND estate_id = ? ORDER BY created_at DESC';
        db.query(sql, [active, estate_id], async (err, result) => {
            if (err) {
                console.error('❌ Database error:', err.message);
                return res.status(500).json({ error: err.message });
            }

            if (result.length === 0) {
                return res.status(404).json({ message: 'Household not found' });
            }

            // Step 3: Cache the result with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
            console.log('💾 Cached active households data');

            res.json(result);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
};

// Get households by estate ID with Redis caching
exports.getHsHlByEstateId = async (req, res) => {
    const { id } = req.params;

    // Construct a unique cache key using the estate ID
    const cacheKey = `households/getBHsHldEstId/:${id}`;

    try {
        // Step 1: Check if the data is cached
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving from Redis cache');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // Step 2: If not cached, query the database
        const sql = 'SELECT * FROM households WHERE estate_id = ? ORDER BY created_at DESC';
        db.query(sql, [id], async (err, result) => {
            if (err) {
                console.error('❌ Database error:', err.message);
                return res.status(500).json({ error: err.message });
            }

            if (result.length === 0) {
                return res.status(404).json({ message: 'Household not found' });
            }

            // Step 3: Cache the result with a 5-minute expiration
            await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
            console.log('💾 Cached household data by estate ID');
            return res.json(result);
        });
    } catch (error) {
        console.error('❌ Redis error:', error.message);
       return res.status(500).json({ error: 'Server error' });
    }
};

// ✅ Create a New Household
exports.createHousehold = async(req, res) => {

    const cacheKey = `households`;

    const { 
        estate_id, primary_owner, spouse_name, caretaker_name, residence_status, 
        contact_number, house_number, section, court, street,  is_official, official_role,active, uid
    } = req.body;

    console.log(req.body)

    // Validate required fields
    if (
        !estate_id || !primary_owner ||!spouse_name || !residence_status || !contact_number || !house_number
    ) {
        return res.status(400).json({ error: "All required fields must be provided" });
    }

    // SQL query to insert the household data
    const sql = `
        INSERT INTO households (
           estate_id, primary_owner, spouse_name, caretaker_name, residence_status, 
        contact_number, house_number, section, court, street,is_official, official_role,active,uid) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?)
    `;

    // Execute the query
    db.query(sql, [
        estate_id, primary_owner, spouse_name, caretaker_name, residence_status, 
        contact_number, house_number, section, court, street, is_official, official_role,active,uid
    ],  (err, result) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).json({ error: err.message });
        }
         redisClient.setEx(cacheKey, 300, JSON.stringify(result));
        res.status(200).json({ 
            message: 'Household created successfully', 
            householdId: result.insertId 
        });
    });
};

exports.updateHouseholdRoles = (req, res) => {
    const { household_id, is_official, official_role } = req.body;

    const sql = `
        UPDATE households 
        SET is_official = ?, official_role = ? 
        WHERE household_id = ?
    `;

    db.query(sql, [is_official, official_role, household_id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(200).json({ message: "Household updated successfully" });
    });
};


exports.existingHousehold = (req,res) =>{
    const phone = req.params.phone;
    const query = "SELECT 1 FROM  households WHERE contact_number = ? ";
    db.query(query, [phone], (err, results) => {
      if (err) {
        console.error("Error executing query:", err);
        return res.status(500).send("Internal Server Error");
      }
  
      if (results.length > 0) {
        console.log("data", results);
        res.send({ exists: true, message: `UID ${phone} exists.` });
      } else {
        res.send({ exists: false, message: `UID ${phone} does not exist.` });
      }
    });

};


// ✅ Update an Existing Household
exports.updateHousehold = async(req, res) => {
    const householdId = req.params.id;
    const fields = req.body;
    const cacheKey = `getActiveHouseHolds/:${householdId}:`;
    // Check if the ID is provided
    if (!householdId) {
        return res.status(400).json({ error: "household ID is required" });
    }
    // Check if there are fields to update
    if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
    }
    // Build dynamic SQL query and values array
    let sql = "UPDATE households SET ";
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
        sql += `${key} = ?, `;
        values.push(value);
    }
    // Remove the last comma and space
    sql = sql.slice(0, -2);

    // Add the WHERE clause
    sql += " WHERE household_id = ?";
    values.push(householdId);

    // Execute the query
    db.query(sql, values, async(err, result) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).json({ error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "household not found" });
        }
        await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
        res.json({ message: "household updated successfully" });
    });
};

// ✅ Delete a Household
exports.deleteHousehold = (req, res) => {
    const { id } = req.params;
    const sql = 'DELETE FROM households WHERE household_id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Household deleted successfully' });
    });
};

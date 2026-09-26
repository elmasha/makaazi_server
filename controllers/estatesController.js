const db = require('../config/db');
const redisClient = require('../config/redis');

const DEFAULT_EXPIRATION = 60;



// Get All Estates
exports.getAllEstates =async (req, res) => {
   // getEstatesFromRedis();
   const cacheKey = `estates`;
   try {
  // Try to get data from Redis
  const cachedData =  await redisClient.get(cacheKey);
  if (cachedData) {
      console.log('🔁 Serving from cache');
      return res.json(JSON.parse(cachedData));
  }else{

  const sql = 'SELECT * FROM estates';

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        redisClient.setEx("estates" , DEFAULT_EXPIRATION, JSON.stringify(results))
        console.log(' Serving from database');
        res.json(results);
    });
  }
} catch (err) {
    console.error("❌ Error fetching data from Redis:", err.message);
    return null;
}
  
};



////.........Get Estate by Name........////
exports.getEstateByName = (req, res) => {
    const estateId = req.params.id;
    const sql = `SELECT * FROM estates WHERE estate_name = ?`;
    db.query(sql, [estateId], (err, results) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(404).send("Error retrieving estate");
        }

        if (results.length === 0) {
            return res.send("Estate not found");
        }

        res.status(200).json(results[0]);
    });
};



////.........Get Estate by ID........////
exports.getEstateById = (req, res) => {
    const estateId = req.params.id;
    const sql = `SELECT * FROM estates WHERE estate_id = ?`;
    db.query(sql, [estateId], (err, results) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).send("Error retrieving estate");
        }

        if (results.length === 0) {
            return res.send("Estate not found");
        }

        res.status(200).json(results[0]);
    });
};

// controllers/subscriptionController.js
exports.checkAndDisableEstateSubscription = (req, res) => {
    const { estate_id } = req.params;

    const sql = `
        SELECT 
            es.subscription_id,
            es.estate_id,
            es.plan_id,
            es.start_date,
            DATE_ADD(es.start_date, INTERVAL 30 DAY) AS due_date,
            es.is_active,
            CASE
                WHEN CURDATE() > DATE_ADD(es.start_date, INTERVAL 30 DAY) THEN 'Due'
                ELSE 'Not Due'
            END AS payment_status
        FROM estate_subscriptions es
        WHERE es.estate_id = ?
    `;

    db.query(sql, [estate_id], (err, results) => {
        if (err) {
            console.error("❌ Error checking subscription:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        if (!results.length) {
            return res.json({ message: "No subscription found" });
        }

        const subscription = results[0];

        if (subscription.payment_status === "Due" && subscription.is_active === 1) {
            const disableSQL = `
                UPDATE estate_subscriptions
                SET is_active = 0
                WHERE estate_id = ?
            `;
            db.query(disableSQL, [estate_id], (err2) => {
                if (err2) {
                    console.error("❌ Error disabling subscription:", err2.message);
                    return res.status(500).json({ error: "Failed to disable subscription" });
                }
                subscription.is_active = 0;
                return res.json({
                    subscription,
                    message: "Subscription is due and has been disabled"
                });
            });
        } else {
            return res.json({
                subscription,
                message: "Subscription is active"
            });
        }
    });
};


exports.checkEstateDue = (req, res) => {
    const { estate_id } = req.params;
    console.log('Due',estate_id);
    const sql = `
        SELECT 
            es.estate_id,
            es.plan_id,
            sp.plan_name,
            es.start_date,
            DATE_ADD(es.start_date, INTERVAL 30 DAY) AS due_date,
            CASE
                WHEN CURDATE() > DATE_ADD(es.start_date, INTERVAL 30 DAY) THEN 'Due'
                ELSE 'Not Due'
            END AS payment_status
        FROM estate_subscriptions es
        JOIN subscription_plans sp ON es.plan_id = sp.plan_id
        WHERE es.estate_id = ?
    `;

    db.query(sql, [estate_id], (err, results) => {
        if (err) {
            console.error("❌ Error checking subscription due:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        if (!results.length) {
            return res.json({ message: "No subscription found for this estate" });
        }

        res.json(results[0]);
    });
};



exports.getBillingMessage = (req, res) => {
    const { estate_id } = req.params;

    const sql = `
        SELECT 
            sp.plan_name,
            es.amount_paid,
            sp.monthly_rate,
            es.start_date,
            DATE_ADD(es.start_date, INTERVAL 1 MONTH) AS next_billing_date,
            h.household_count
        FROM estate_subscriptions es
        JOIN subscription_plans sp ON es.plan_id = sp.plan_id
        JOIN (
            SELECT estate_id, COUNT(*) AS household_count
            FROM households
            GROUP BY estate_id
        ) h ON es.estate_id = h.estate_id
        WHERE es.estate_id = ?;
    `;

    db.query(sql, [estate_id], (err, results) => {
        if (err) {
            console.error("❌ Error fetching billing details:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        if (results.length === 0) {
            return res.json({ message: "No active subscription found for this estate." });
        }

        const plan = results[0];
        const message = `Your estate is on the  ${plan.plan_name} plan (${plan.household_count} households), billed at KSh ${plan.monthly_rate} per month. Your next billing date is ${new Date(plan.next_billing_date).toLocaleDateString()}.`;

        res.status(200).json({ plan, message });
    });
};




exports.checkDueSubscriptions = (req, res) => {
    const sql = `
        SELECT 
            es.estate_id,
            e.estate_name,
            es.start_date,
            DATEDIFF(CURDATE(), es.start_date) AS days_since_last_payment,
            CASE 
                WHEN DATEDIFF(CURDATE(), es.start_date) > 30 THEN 'Due'
                ELSE 'Not Due'
            END AS payment_status
        FROM estate_subscriptions es
        JOIN estates e ON es.estate_id = e.estate_id
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("❌ Error checking due payments:", err.message);
            return res.status(500).json({ error: "Database error" });
        }
        res.status(200).json(results);
    });
};


////.........Get Estate by ID........////
exports.getEstateSubById = (req, res) => {
    const estateId = req.params.id;
    const sql = `SELECT * FROM estate_subscriptions  WHERE estate_id = ?`;
    db.query(sql, [estateId], (err, results) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).send("Error retrieving estate");
        }

        if (results.length === 0) {
            return res.send("Estate not found");
        }

        res.status(200).json(results[0]);
    });
};



// Create Estate
exports.createEstate = (req, res) => {
        
  // Now continue to insert the estate (your original code goes here)
  const { estate_name, estate_urn, estate_location, street, section, court, latitude, longitude, estate_image, logo_url, created_at, updated_at } = req.body;

  const sql = `
    INSERT INTO estates (estate_name, estate_urn, estate_location, street, section, court, latitude, longitude, estate_image, logo_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(sql, [
    estate_name, estate_urn, estate_location, street, section, court,
    latitude, longitude, estate_image, logo_url, created_at, updated_at
  ], (err, result) => {

    if (err) {
      return res.status(500).json({ error: err.message });
    }
    return res.status(201).json({
          message: 'Estate and address config created',
          estate_id: result.insertId
        });
  });

};


// Create Estate
exports.createEstateConfig = (req, res) => {
        
  // Now continue to insert the estate (your original code goes here)
  const { estate_id, street, section, court } = req.body;

    // Then insert into the config table
    const configSQL = `
      INSERT INTO estate_address_config (estate_id, street, section, court)
      VALUES (?, ?, ?, ?)
    `;
    db.query(
      configSQL,
      [
        estate_id,
        street,
        section,
        court,
      ],
      (err2) => {
       
      if (err2) {
       return res.status(500).json({ error: err2.message });
      }
      return res.status(201).json({
          message: 'Estate config created',
          estate_id: estate_id
        });
      }
    );
};



///.......Update Estate......////
exports.updateEstate = (req, res) => {
    const estateId = req.params.id;
    const fields = req.body;

    // Check if the ID is provided
    if (!estateId) {
        return res.status(400).json({ error: "Estate ID is required" });
    }
    // Check if there are fields to update
    if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
    }
    // Build dynamic SQL query and values array
    let sql = "UPDATE estates SET ";
    const values = [];

    for (const [key, value] of Object.entries(fields)) {
        sql += `${key} = ?, `;
        values.push(value);
    }
    // Remove the last comma and space
    sql = sql.slice(0, -2);

    // Add the WHERE clause
    sql += " WHERE estate_id = ?";
    values.push(estateId);

    // Execute the query
    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("Database Error:", err.message);
            return res.status(500).json({ error: err.message });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Estate not found" });
        }

        res.json({ message: "Estate updated successfully" });
    });
};


////......Search Estates...../////
exports.searchEstates = async (req, res) => {
    const { query } = req.query; // Retrieve the search query from the client

    if (!query) {
        return res.status(400).send("Search query is required");
    }

    // Full-Text Search Query
    const cacheKey = `searchEstates/:${query}`;

    try {
        // Check Redis cache for the search results
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving search results from cache');
            return res.status(200).json(JSON.parse(cachedResults));
        }

        

        // Full-Text Search Query (MySQL)
        let sql = `
            SELECT estate_id,estate_name, estate_urn, estate_location
            FROM estates
            WHERE MATCH(estate_name, estate_urn, estate_location) AGAINST(? IN NATURAL LANGUAGE MODE)
        `;
        db.query(sql, query, async (err, results) => {
            if (err) {
                console.error('❌ Error searching estates:', err);
                return res.status(500).send("Error searching posts");
            }

            // Cache the results in Redis with an expiration of 1 minute
            await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
            console.log('💾 Search results cached');

           return res.status(200).json(results);
        });
    } catch (error) {
        console.error('❌ Redis error:', error);
        return  res.status(500).send("Server error");
    }


};


////......Search Estates...../////
exports.searchAllEstates = async (req, res) => {
    const { query } = req.query; // Retrieve the search query from the client

    if (!query) {
        return res.status(400).send("Search query is required");
    }

    // Full-Text Search Query
    const cacheKey = `searchAll/:${query}`;

    try {
        // Check Redis cache for the search results
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
            console.log('🔁 Serving search results from cache', cachedResults);
            return res.status(200).json(JSON.parse(cachedResults));
        }

        // Full-Text Search Query (MySQL)
        let sql = `
            SELECT estate_name, estate_urn, estate_location
            FROM estates
            WHERE MATCH(estate_name, estate_urn, estate_location) AGAINST(? IN NATURAL LANGUAGE MODE)
        `;
        db.query(sql, query, async (err, results) => {
            if (err) {
                console.error('❌ Error searching estates:', err);
                return res.status(500).send("Error searching posts");
            }

            // Cache the results in Redis with an expiration of 1 minute
            await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
            console.log('💾 Search results cached',results);

           return res.status(200).json(results);
        });
    } catch (error) {
        console.error('❌ Redis error:', error);
       return res.status(500).send("Server error");
    }


};



////.......Delete Estate...../////
exports.deleteEstate = (req, res) => {
    const estateId = req.params.id;

    const sql = `DELETE FROM estates WHERE estate_id = ?`;

    db.query(sql, [estateId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Estate not found' });
        }

        res.json({ message: 'Estate deleted successfully' });
    });
};

function getSubscriptionRate(householdCount) {
    if (householdCount <= 20) return 2000;
    if (householdCount <= 50) return 2500;
    if (householdCount <= 100) return 3000;
    return 4000;
}

exports.subscription =  (req, res) => {
    const { estate_id } = req.body;
    const householdCountQuery = "SELECT COUNT(*) AS count FROM households WHERE estate_id = ?";
    db.query(householdCountQuery, [estate_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        const total_households = results[0].count;
        const billing_rate = getSubscriptionRate(total_households);

        // Trigger STK push here or return this info to frontend
        res.json({
            estate_id,
            total_households,
            billing_rate,
            message: `Subscription for Ksh ${billing_rate} initiated.`
        });
    });
};


async function getEstatesFromRedis() {
    
}
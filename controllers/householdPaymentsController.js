// controllers/householdPaymentsController.js
const db = require("../config/db");
const redisClient = require("../config/redis");

const MONTHLY_RATE = 2000;
const YEARLY_DUE = 24000;
const CACHE_TTL = 60 * 2; // 5 minutes

exports.getHouseholdPaymentsByAddress = async (req, res) => {
    const { estate_id, section, street, court, year } = req.query;

    if (!estate_id) {
        return res.status(400).json({ error: "estate_id is required" });
    }

    const selectedYear = parseInt(year) || new Date().getFullYear();
    const currentMonth =
        selectedYear === new Date().getFullYear()
            ? new Date().getMonth() + 1
            : 12;

    const cacheKey = `payments:${estate_id}:${selectedYear}:${section || "all"}:${street || "all"}:${court || "all"}`;

    try {
        // 🔹 1. CHECK CACHE
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
            return res.json(JSON.parse(cachedData));
        }

        // 🔹 2. BUILD QUERY
        let conditions = ["h.estate_id = ?", "hp.year = ?"];
        let values = [estate_id, selectedYear];

        if (section) {
            conditions.push("h.section = ?");
            values.push(section);
        }
        if (street) {
            conditions.push("h.street = ?");
            values.push(street);
        }
        if (court) {
            conditions.push("h.court = ?");
            values.push(court);
        }

        const sql = `
            SELECT
                hp.id,
                hp.household_id,
                hp.full_name,

                h.house_number,
                h.section,
                h.street,
                h.court,

                hp.year,
                hp.january,
                hp.february,
                hp.march,
                hp.april,
                hp.may,
                hp.june,
                hp.july,
                hp.august,
                hp.september,
                hp.october,
                hp.november,
                hp.december,

                hp.total_paid,
                hp.balance_brought_forward AS balance_bf
            FROM household_payments hp
            INNER JOIN households h
                ON hp.household_id = h.household_id
            WHERE ${conditions.join(" AND ")}
            ORDER BY h.section, h.street, h.court, h.house_number
        `;

        const [rows] = await db.promise().query(sql, values);

        // 🔹 3. PROCESS DATA
        const results = rows.map(row => {
            const expectedToDate = currentMonth * MONTHLY_RATE;
            const totalDueToDate = expectedToDate + row.balance_bf;
            const overdue = Math.max(totalDueToDate - row.total_paid, 0);
            const monthsEquivalent = row.total_paid / MONTHLY_RATE;

            let status = "Paid";
            if (row.total_paid < totalDueToDate) status = "Overdue";
            if (row.total_paid > totalDueToDate) status = "Prepaid";

            return {
                ...row,
                due_year_to_date: YEARLY_DUE,
                expected_to_date: expectedToDate,
                overdue,
                months_equivalent: Number(monthsEquivalent.toFixed(2)),
                status
            };
        });

        // 🔹 4. STORE IN CACHE
        await redisClient.setEx(
            cacheKey,
            CACHE_TTL,
            JSON.stringify(results)
        );

        return res.json(results);

    } catch (err) {
        console.error("Payments by address error:", err.message);
        return res.status(500).json({ error: "Failed to fetch payments" });
    }
};


// Get all payments (optionally filter by estate_id or household_id)
exports.getAllPayments = async (req, res) => {
  const { estate_id, household_id } = req.query;
  let sql = 'SELECT * FROM household_payments';
  const params = [];
  let cacheKey = 'householdPayments:all';

  if (estate_id || household_id) {
    sql += ' WHERE';
    if (estate_id) {
      sql += ' estate_id = ?';
      params.push(estate_id);
    }
    if (household_id) {
      sql += (params.length > 0 ? ' AND' : '') + ' household_id = ?';
      params.push(household_id);
    }
    cacheKey += `:estate_${estate_id || ''}:household_${household_id || ''}`;
  }

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    db.query(sql, params, async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
      res.json(results);
    });
  } catch (err) {
    res.status(500).json({ error: 'redisClient error' });
  }
};

// Monthly Summary for a household
exports.getMonthlySummary = async (req, res) => {
  const { household_id } = req.params;
  const cacheKey = `householdPayments:summary:${household_id}`;
  const sql = 'SELECT * FROM household_payments WHERE household_id = ?';

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    db.query(sql, [household_id], async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0) return res.status(404).json({ message: 'Household not found' });
      await redisClient.setEx(cacheKey, 300, JSON.stringify(results[0]));
      res.json(results[0]);
    });
  } catch (err) {
    res.status(500).json({ error: 'redisClient error' });
  }
};

// Get overdue households
exports.getOverdueHouseholds = async (req, res) => {
  const cacheKey = 'householdPayments:overdue';
  const sql = 'SELECT * FROM household_payments WHERE due_year_to_date > total_paid';

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    db.query(sql, async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
      res.json(results);
    });
  } catch (err) {
    res.status(500).json({ error: 'redisClient error' });
  }
};

// Get by ID
exports.getPaymentById = async (req, res) => {
  const { id } = req.params;
  const cacheKey = `householdPayments:${id}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    db.query('SELECT * FROM household_payments WHERE id = ?', [id], async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0) return res.status(404).json({ message: 'Not found' });
      await redisClient.setEx(cacheKey, 300, JSON.stringify(results[0]));
      res.json(results[0]);
    });
  } catch (err) {
    res.status(500).json({ error: 'redisClient error' });
  }
};

exports.getPaymentByUid = async (req, res) => {
  const { id } = req.params;
  const cacheKey = `householdPaymentsUid:${id}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    db.query('SELECT * FROM household_payments WHERE uid = ?', [id], async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0) return res.status(404).json({ message: 'Not found' });
      await redisClient.setEx(cacheKey, 300, JSON.stringify(results[0]));
      res.json(results[0]);
    });
  } catch (err) {
    res.status(500).json({ error: 'redisClient error' });
  }
};

// Create
exports.createPayment = async (req, res) => {
  const data = req.body;
  db.query('INSERT INTO household_payments SET ?', data, async (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    await redisClient.del('householdPayments:all');
    res.status(201).json({ message: 'Created', id: result.insertId });
  });
};

// Update
exports.updatePayment = async (req, res) => {
  const { id } = req.params;
  const data = req.body;
  const fields = req.body;

  if (!id) return res.status(400).json({ error: 'household ID is required' });
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'No fields to update' });

  let sql = 'UPDATE household_payments SET ';
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    sql += `${key} = ?, `;
    values.push(value);
  }
  sql = sql.slice(0, -2);
  sql += ' WHERE id = ?';
  values.push(id);

  db.query(sql, values, async (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Not found' });
    await redisClient.del('householdPayments:all');
    await redisClient.del(`householdPayments:${id}`);
    res.json({ message: 'Updated successfully' });
  });
};

// Delete
exports.deletePayment = async (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM household_payments WHERE id = ?', [id], async (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Not found' });
    await redisClient.del('householdPayments:all');
    await redisClient.del(`householdPayments:${id}`);
    res.json({ message: 'Deleted' });
  });
};



exports.applyMonthlyPayment = (req, res) => {
  const {
    household_id,
    estate_id,
    month,
    amount_paid,
    expected_monthly_rate
     // ✅ now from req.body
  } = req.body;

  const monthColumn = month.toLowerCase();

  const validMonths = [
    'january', 'february', 'march', 'april',
    'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december'
  ];

  if (!validMonths.includes(monthColumn)) {
    return res.status(400).json({ error: 'Invalid month' });
  }

  const getSQL = 'SELECT * FROM household_payments WHERE household_id = ? AND estate_id = ? LIMIT 1';

  db.query(getSQL, [household_id, estate_id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: 'Record not found' });

    const record = results[0];

    const newMonthAmount = parseFloat(amount_paid);
    const newDueYTD2 = parseFloat((expected_monthly_rate * 12) + record.balance_brought_forward || 0);
    const newDueYTD = newDueYTD2/ 10; // ✅ use the provided due

    // Recalculate total_paid using the new amount
     let totalPaid = 0;
    validMonths.forEach(m => {
      if (m === monthColumn) {
        totalPaid += newMonthAmount;
      } else {
        totalPaid += parseFloat(record[m] || 0);
      }
    });

    const monthsEquivalent = (totalPaid / expected_monthly_rate).toFixed(1);

    const updateSQL = `
      UPDATE household_payments 
      SET ${monthColumn} =++?, total_paid = ?, due_year_to_date = ?, months_equivalent = ?
      WHERE household_id = ? AND estate_id = ?
    `;

    db.query(
      updateSQL,
      [newMonthAmount, totalPaid, newDueYTD, monthsEquivalent, household_id, estate_id],
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        console.log('Summary',newDueYTD)
        res.json({
          message: `Payment of ${amount_paid} set for ${month}`,
          updated_month_amount: newMonthAmount,
          total_paid: totalPaid,
          due_year_to_date: newDueYTD,
          months_equivalent: monthsEquivalent
        });
      }
    );
  });
};



exports.getSummaryByEstateId = (req, res) => {
  const { id } = req.params;
  const filters = req.query;

  if (!id) {
    return res.status(400).json({ error: 'estate_id is required' });
  }

  // Define which filters belong to which table
  const hpFields = [
    'household_id', 'year', 'total_paid', 'due_year_to_date',
    'months_equivalent', 'balance_brought_forward', 'january', 'february',
    'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december'
  ];

  const hFields = ['name', 'primary_owner', 'phone', 'plot_number']; // extend as needed

  let sql = `
    SELECT 
      hp.id,
      hp.household_id,
      hp.estate_id,
      h.primary_owner AS name,
      hp.january, hp.february, hp.march, hp.april,
      hp.may, hp.june, hp.july, hp.august,
      hp.september, hp.october, hp.november, hp.december,
      hp.total_paid,
      hp.due_year_to_date,
      (hp.due_year_to_date - hp.total_paid) AS overdue,
      hp.months_equivalent,
      hp.balance_brought_forward AS balance_bf,
      hp.year
    FROM household_payments hp
    JOIN households h ON hp.household_id = h.household_id
    WHERE hp.estate_id = ?
  `;

  const params = [id];

  for (const key in filters) {
    if (filters.hasOwnProperty(key)) {
      if (hFields.includes(key)) {
        // Use LIKE for text fields in households table
        sql += ` AND h.${key} LIKE ?`;
        params.push(`%${filters[key]}%`);
      } else if (hpFields.includes(key)) {
        sql += ` AND hp.${key} = ?`;
        params.push(filters[key]);
      }
    }
  }

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    return res.status(200).json(results);
  });
};



exports.getSummaryByHouseholdId = (req, res) => {
  const { household_id } = req.params;
  const { year } = req.query; // Optional: use to filter by year

  if (!household_id) {
    return res.status(400).json({ error: 'household_id is required' });
  }

  let sql = `
    SELECT 
      hp.id,
      hp.household_id,
      hp.estate_id,
      h.primary_owner AS name,
      hp.january, hp.february, hp.march, hp.april,
      hp.may, hp.june, hp.july, hp.august,
      hp.september, hp.october, hp.november, hp.december,
      hp.total_paid,
      hp.due_year_to_date,
      (hp.due_year_to_date - hp.total_paid) AS overdue,
      hp.months_equivalent,
      hp.balance_brought_forward AS balance_bf,
      hp.year
    FROM household_payments hp
    JOIN households h ON hp.household_id = h.household_id
    WHERE hp.household_id = ?
  `;

  const params = [household_id];

  if (year) {
    sql += ' AND hp.year = ?';
    params.push(year);
  }

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
   return res.status(200).json(results); // If you expect a single record per year
  });
};

exports.initializeNewYearPayments = (req, res) => {
    const currentYear = new Date().getFullYear();
    const newYear = currentYear + 1;

    const fetchPreviousYear = `
        SELECT * FROM household_payments WHERE year = ?
    `;

    db.query(fetchPreviousYear, [currentYear], (err, previousRecords) => {
        if (err) return res.status(500).json({ error: 'Database error fetching previous records' });

        const insertNewRecords = previousRecords.map(record => {
            const balance = (record.due_year_to_date || 0) - (record.total_paid || 0);
            return [
                record.household_id,
                record.estate_id,
                record.full_name,
                newYear,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, // total_paid
                0, // due_year_to_date (you may preload new charges here)
                0, // months_equivalent
                balance < 0 ? 0 : balance // carry forward only if positive
            ];
        });

        if (insertNewRecords.length === 0) {
            return res.status(200).json({ message: 'No data to carry forward' });
        }

        const insertQuery = `
            INSERT INTO household_payments (
                household_id, estate_id, full_name, year,
                january, february, march, april, may, june, july, august, september, october, november, december,
                total_paid, due_year_to_date, months_equivalent, balance_brought_forward
            ) VALUES ?
        `;

        db.query(insertQuery, [insertNewRecords], (err, result) => {
            if (err) return res.status(500).json({ error: 'Error inserting new year records' });

            res.status(201).json({ message: `Initialized ${result.affectedRows} records for year ${newYear}` });
        });
    });
};


exports.getHouseholdYearlySummary = (req, res) => {
  const year = new Date().getFullYear();

  const sql = `
    SELECT 
      hp.id,
      h.primary_owner AS name,
      hp.balance_brought_forward AS balance_bf,
      hp.january, hp.february, hp.march, hp.april,
      hp.may, hp.june, hp.july, hp.august,
      hp.september, hp.october, hp.november, hp.december,
      hp.total_paid,
      hp.due_year_to_date,
      (hp.due_year_to_date - hp.total_paid) AS overdue,
      hp.months_equivalent
    FROM household_payments hp
    JOIN households h ON hp.household_id = h.household_id
    WHERE hp.year = ?
    ORDER BY h.primary_owner ASC
  `;

  db.query(sql, [year], (err, results) => {
    if (err) {
      console.error('Error fetching yearly summary:', err.message);
      return res.status(500).json({ error: err.message });
    }

    res.json(results);
  });
};



exports.getHouseholdYearlySummaryEstate = async (req, res) => {
  const year = new Date().getFullYear();
  const estateId = req.params.id;

  if (!estateId) {
    return res.status(400).json({ error: 'estate_id is required' });
  }

  const cacheKey = `yearlySummary:${estateId}:${year}`;

  try {
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log('🔁 Serving from redisClient');
      return res.json(JSON.parse(cachedData));
    }

    const sql = `
      SELECT 
        hp.id,
        h.primary_owner AS name,
        hp.balance_brought_forward AS balance_bf,
        hp.january, hp.february, hp.march, hp.april,
        hp.may, hp.june, hp.july, hp.august,
        hp.september, hp.october, hp.november, hp.december,
        hp.total_paid,
        hp.due_year_to_date,
        (hp.due_year_to_date - hp.total_paid) AS overdue,
        hp.months_equivalent
      FROM household_payments hp
      JOIN households h ON hp.household_id = h.household_id
      WHERE hp.year = ? AND hp.estate_id = ?
      ORDER BY h.primary_owner ASC
    `;

    db.query(sql, [year, estateId], async (err, results) => {
      if (err) {
        console.error('❌ MySQL error:', err.message);
        return res.status(500).json({ error: err.message });
      }

      // Cache for 5 minutes
      await redisClient.setEx(cacheKey, 100, JSON.stringify(results));

      res.json(results);
    });
  } catch (error) {
    console.error('❌ redisClient error:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
};




 // Make sure redisClient is configured and connected

exports.getAllHouseholdPayments = async (req, res) => {
  const cacheKey = 'householdPayments:all';

  try {
    // 1. Try to fetch from redisClient cache
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log('✅ Data from redisClient cache');
      return res.json(JSON.parse(cachedData));
    }

    // 2. If not cached, fetch from MySQL
    db.query('SELECT * FROM household_payments', async (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      // 3. Store in redisClient (expires in 5 minutes)
      await redisClient.setEx(cacheKey, 300, JSON.stringify(results));
      console.log('✅ Data from MySQL and cached in redisClient');
      res.json(results);
    });
  } catch (error) {
    console.error('❌ redisClient error:', error.message);
    res.status(500).json({ error: 'redisClient error' });
  }
};



exports.getPaymentsByEstateId = (req, res) => {
  const { estate_id } = req.params;

  if (!estate_id) {
    return res.status(400).json({ error: 'estate_id is required' });
  }

  const sql = 'SELECT * FROM household_payments WHERE estate_id = ?';

  db.query(sql, [estate_id], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(results);
  });
};





exports.getHouseholdDashboard = async (req, res) => {
    const { uid } = req.params;
    const cacheKey = `dashboard:${uid}`;

    try {
        // 1️⃣ Redis cache
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.json(JSON.parse(cached));
        }

        // 2️⃣ DB query
        const [rows] = await db.promise().query(
            `
            SELECT
                ROUND((due_year_to_date / 12) * MONTH(CURDATE()), 2) AS due_to_date,
                (
                    CASE WHEN MONTH(CURDATE()) >= 1  THEN january   ELSE 0 END +
                    CASE WHEN MONTH(CURDATE()) >= 2  THEN february  ELSE 0 END +
                    CASE WHEN MONTH(CURDATE()) >= 3  THEN march     ELSE 0 END +
                    CASE WHEN MONTH(CURDATE()) >= 4  THEN april     ELSE 0 END +
                    CASE WHEN MONTH(CURDATE()) >= 5  THEN may       ELSE 0 END +
                    CASE WHEN MONTH(CURDATE()) >= 6  THEN june      ELSE 0 END +
                    CASE WHEN MONTH(CURDATE()) >= 7  THEN july      ELSE 0 END +
                    CASE WHEN MONTH(CURDATE()) >= 8  THEN august    ELSE 0 END +
                    CASE WHEN MONTH(CURDATE()) >= 9  THEN september ELSE 0 END +
                    CASE WHEN MONTH(CURDATE()) >= 10 THEN october   ELSE 0 END +
                    CASE WHEN MONTH(CURDATE()) >= 11 THEN november  ELSE 0 END +
                    CASE WHEN MONTH(CURDATE()) >= 12 THEN december  ELSE 0 END
                ) AS total_paid_to_date,
                due_year_to_date
            FROM household_payments
            WHERE uid = ?
            AND year = YEAR(CURDATE())
            `,
            [uid]
        );

        if (!rows.length) {
            return res.json({
                due_to_date: 0,
                overdue: 0,
                monthly_equivalent: 0,
                status: "No Charges"
            });
        }

        const row = rows[0];
      

          const monthlyRate = row.due_year_to_date / 12;

          const dueToDate = Number(row.due_to_date);
          const totalPaid = Number(row.total_paid_to_date);

          const overdue = dueToDate - totalPaid;

          // ✅ FIXED LOGIC
          const monthlyEquivalent =
              monthlyRate > 0
                  ? Number((totalPaid / monthlyRate).toFixed(2))
                  : 0;

          // Status
          let status = "Paid";
          if (overdue > 0) status = "Overdue";
          else if (overdue < 0) status = "Prepaid";

        const response = {
            due_to_date: Number(row.due_to_date),
            overdue: Number(overdue),
            total_paid:Number(totalPaid),
            monthly_equivalent: monthlyEquivalent,
            status
        };

        // 4️⃣ Cache (5 minutes)
        await redisClient.setEx(cacheKey, 200, JSON.stringify(response));

        return res.json(response);

    } catch (err) {
        console.error("Dashboard error:", err.message);
        return res.status(500).json({ error: "Dashboard fetch failed" });
    }
};
const db = require('../config/db');
const redisClient = require('../config/redis');

const DEFAULT_EXPIRATION = 60;


// controllers/chartController.js
exports.getMonthlyEstateSummary = (req, res) => {
  const { estate_id, year } = req.query;
  const sql = `
    SELECT
      SUM(january) AS january, SUM(february) AS february, SUM(march) AS march,
      SUM(april) AS april, SUM(may) AS may, SUM(june) AS june,
      SUM(july) AS july, SUM(august) AS august, SUM(september) AS september,
      SUM(october) AS october, SUM(november) AS november, SUM(december) AS december
    FROM household_payments
    WHERE estate_id = ? AND year = ?
  `;

  db.query(sql, [estate_id, year], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(200).json(results);
  });
};



exports.getHouseholdTrendsByEstate = (req, res) => {
  const { estate_id } = req.params;

  if (!estate_id) {
    return res.status(400).json({ error: "Missing estate_id parameter" });
  }

  const sql = `
    SELECT 
      DATE_FORMAT(created_at, '%Y-%m') AS month,
      COUNT(*) AS total_registrations
    FROM households
    WHERE estate_id = ?
    GROUP BY month
    ORDER BY month ASC
  `;

  db.query(sql, [estate_id], (err, results) => {
    if (err) {
      console.error("❌ Error fetching estate trends:", err.message);
      return res.status(500).json({ error: err.message });
    }

    res.status(200).json(results);
  });
};

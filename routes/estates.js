const express = require('express');
const router = express.Router();
const db = require('../config/db');

const {
  // READ
  getAllEstates,
  getEstateById,
  getEstateByName,
  getEstateSubById,

  // WRITE
  createEstate,
  createEstateConfig, // deprecated but kept
  updateEstate,
  deleteEstate,

  // SEARCH
  searchEstates,
  searchAllEstates, // deprecated alias

  // SUBSCRIPTION
  subscription,
  checkEstateDue,
  getBillingMessage,
  checkDueSubscriptions,
  checkAndDisableEstateSubscription,
} = require('../controllers/estatesController');

// ============================================================
// LIST & SEARCH
// ============================================================
router.get('/', getAllEstates);
router.get('/getAll', getAllEstates);   // camelCase
router.get('/getall', getAllEstates);   // ← NEW: lowercase alias (frontend uses this)
router.get('/search', searchEstates);
router.get('/searchAll', searchAllEstates); // deprecated alias

// ============================================================
// SUBSCRIPTION (place BEFORE /estate/:id so "subscriptions"
// isn't swallowed by the :id matcher)
// ============================================================
router.post('/subscription', subscription);
router.get('/subscriptions/due', checkDueSubscriptions);
router.get('/subscriptions/:estate_id/check', checkEstateDue);
router.get('/subscriptions/:estate_id/billing-message', getBillingMessage);
router.get(
  '/subscriptions/:estate_id/disable-if-due',
  checkAndDisableEstateSubscription
);

// ============================================================
// READ
// ============================================================
router.get('/estate/:id', getEstateById);
router.get('/name/:id', getEstateByName);
router.get('/estateName/:id', getEstateByName);   // ← NEW: alias (frontend uses this)
router.get('/subscription/:id', getEstateSubById);

// ============================================================
// WRITE
// ============================================================
router.post('/create', createEstate);
router.post('/createConfig', createEstateConfig); // deprecated, use /create
router.patch('/update_estate/:id', updateEstate);
router.delete('/delete/:id', deleteEstate);

// routes/estates.js (or wherever your public estate routes live)
router.get('/subscription-plans', async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT plan_id, plan_name, min_households, max_households, monthly_rate
       FROM subscription_plans
       ORDER BY min_households ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('public subscription-plans error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

module.exports = router;
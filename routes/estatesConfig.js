const express = require('express');
const router = express.Router();

const {
  // READ
  getEstateAddressConfig,
  getAddressConfig, // deprecated alias

  // WRITE
  saveEstateAddressConfig,
  createEstateAddress, // deprecated alias

  // DROPDOWNS
  getAddressDropdowns,

  // ADD COMPONENTS
  addSection,
  addCourt,
  addStreet,
} = require('../controllers/estateConfigController');

// ============================================================
// CONFIG
// ============================================================
router.get('/estate/:estate_id', getEstateAddressConfig);
router.post('/save', saveEstateAddressConfig);

// Legacy aliases (map to the same handlers)
router.get('/config/:estate_id', getAddressConfig);
router.post('/create', createEstateAddress);

// ============================================================
// DROPDOWNS
// ============================================================
router.get('/dropdowns/:estate_id', getAddressDropdowns);

// ============================================================
// ADD ADDRESS COMPONENTS
// ============================================================
router.post('/section/add', addSection);
router.post('/court/add', addCourt);
router.post('/street/add', addStreet);

module.exports = router;
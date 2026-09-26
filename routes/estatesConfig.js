const express = require('express');
const router = express.Router();
const { getAddressConfig, createEstateAddress,getEstateAddressConfig,saveEstateAddressConfig,addSection,addCourt,addStreet,getAddressDropdowns } = require('../controllers/estateConfigController');

router.post('/create', createEstateAddress);    // Create a new estate
router.get('/get_estates/:id', getAddressConfig);// get estate
// ======================
// CONFIG
// ======================
router.get("/config/:estate_id", getEstateAddressConfig);
router.post("/config", saveEstateAddressConfig);

// ======================
// ADMIN – DROPDOWN SETUP
// ======================
router.post("/add-section", addSection);
router.post("/add-court", addCourt);
router.post("/add-street", addStreet);

// ======================
// REGISTRATION
// ======================
router.get("/dropdowns/:estate_id", getAddressDropdowns);

module.exports = router;

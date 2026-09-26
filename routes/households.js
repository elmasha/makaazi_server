const express = require('express');
const router = express.Router();
const {
    getAllHouseholds,
    getHouseholdById,
    createHousehold,
    updateHousehold,
    deleteHousehold,
    updateHouseholdRoles,
    getHsHlByEstateId,
    getActiveEstate,
    searchHouseholds,
    searchHouseholdsId,
    getActiveHouseHolds,
    getOfficials,
    existingHousehold,
    getHouseholdByPhone,
    getHouseholdId,
    getHouseholdsByAddress
} = require('../controllers/householdsController');

router.get('/getAll', getAllHouseholds);           // Get all households
router.get('/getHousehold/:id', getHouseholdById);         // Get a single household by ID
router.post('/addHousehold', createHousehold);            // Create a new household
router.patch('/update_household/:id', updateHousehold);           // Update a household
router.delete('/deleteHousehold/:id', deleteHousehold);        // Delete a household
router.post('/updateRoles/:id', updateHouseholdRoles);
router.get('/getBHsHldEstId/:id', getHsHlByEstateId);        // Delete a household        // Delete a household
router.get('/getHouseHoldId/:id', getHouseholdId);        // Delete a household
router.get('/getActiveEstate/:active/:estate_id', getActiveEstate);
router.get('/getActiveaddHouseHold/:active/', getActiveHouseHolds);        // Delete a household
router.get('/search', searchHouseholds);        // Delete a household
router.get('/searchExisting/:phone', existingHousehold);        // Delete a household
router.get('/searchEstate/:id', searchHouseholdsId);        // Delete a household
router.get('/getOfficials/:is_official', getOfficials);   
router.get('/getOfficialsEstate/:estateId/:is_official', getOfficials); 
router.get('/getHouseHoldByPhone/:contact_number', getHouseholdByPhone);  
router.get("/by-address", getHouseholdsByAddress); 

     // Delete a household


module.exports = router;

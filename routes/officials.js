const express = require('express');
const router = express.Router();
const { getAllOfficials, addOfficial,getOfficialById,updateOfficial,getOfficialByContact,searchOfficials,deleteOfficial,existingOfficial,getOfficialByEstateId,getAddressSummary }= require('../controllers/officialsController');

router.get('/getAll', getAllOfficials);   // Get all officials
router.post('/addOfficial', addOfficial);      // Create a new official
router.patch('/update_official/:id', updateOfficial);// update official
router.put('/delete_official/:id', deleteOfficial);// delete official
router.get('/search', searchOfficials);// search official
router.get('/getofficial/:uid', getOfficialById);// get official by id
router.get('/getOfficialByContact/:phone', getOfficialByContact);// get official by id
router.get('/getOfficialByEstateId/:estate_id', getOfficialByEstateId);// get official by  estate id
router.get('/existing_official/:phone', existingOfficial);// get official by id
// type = section | street | court
router.get("/address-summary", getAddressSummary);


module.exports = router;

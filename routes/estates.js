const express = require('express');
const router = express.Router();
const { getAllEstates,createEstateConfig ,createEstate,checkAndDisableEstateSubscription,checkEstateDue,updateEstate,searchEstates,getBillingMessage,deleteEstate,getEstateById,searchAllEstates,getEstateByName,subscription,getEstateSubById,checkDueSubscriptions } = require('../controllers/estatesController');

router.get('/getall', getAllEstates);    // Get all estates
router.post('/create', createEstate);    // Create a new estate
router.post('/create-config', createEstateConfig);    // Create a new estate
router.patch('/update_estates/:id', updateEstate);// update estate
router.put('/delete_estates/:id', deleteEstate);// delete estate
router.get('/search', searchEstates);// search estate
router.get('/searchAll', searchAllEstates);// search all estate
router.get('/estate/:id', getEstateById);// get estate by id 
router.get('/estate-due-disable/:estate_id', checkAndDisableEstateSubscription);// get estate b
router.get('/estate-due/:estate_id', checkEstateDue);// get estate by id 
router.get('/estate-sub-msg/:estate_id', getBillingMessage);// get estate by id 
router.get('/estate-sub/:id', getEstateSubById);// get estate by id 
router.get('/estate-check-sub/:id', checkDueSubscriptions);// get estate by id 
router.get('/estateName/:id', getEstateByName);// get estate by id
router.post('/subscription', subscription);// get estate by id



module.exports = router;

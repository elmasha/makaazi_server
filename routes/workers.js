const express = require('express');
const router = express.Router();
const { getAllWorkers, addWorker,getWorkersById,getWorkerByEstate,updateWorker,searchWorkers,deleteWorker,existingWorker,searchEstateWorkers }= require('../controllers/workersController');

router.get('/getAll', getAllWorkers);   // Get all Workers
router.post('/addWorkers', addWorker);      // Create a new Workers
// router.patch('/update_Workers/:id', updateWorker);// update Workers
// router.put('/delete_Workers/:id', deleteWorker);// delete Workers
// router.get('/search', searchWorkers);// search Workers
 router.get('/getWorkersEstate/:id', getWorkerByEstate);// get Workers by id
  router.get('/searchWorkersEstate', searchEstateWorkers);// search Workers by estate_id

// router.get('/existing_Workers/:phone', existingWorker);// get Workers by id


module.exports = router;

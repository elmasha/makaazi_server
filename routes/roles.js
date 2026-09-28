const router = require('express').Router();
const rolesController = require('../controllers/rolesController');

router.get('/',              rolesController.getAllRoles);
router.get('/for-user/:uid', rolesController.getRoleForUser);   // <-- NEW
router.post('/',             rolesController.createRole);
router.patch('/:id',         rolesController.updateRole);       // <-- NEW
router.delete('/:id',        rolesController.deleteRole);       // <-- NEW

module.exports = router;
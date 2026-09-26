const express = require('express');
const router = express.Router();
const { queueSms } = require('../services/smsService');
const sms = require('../services/smsTemplates');

router.post('/test-sms', async (req, res) => {
  const { phone, kind, name } = req.body;
  const map = {
    assigned: sms.officialAssigned({ name: name || 'Test', role: 'Chairman', estateName: 'Test Estate' }),
    promoted: sms.officialPromoted({ name: name || 'Test', oldRole: 'Secretary', newRole: 'Chairman', estateName: 'Test Estate' }),
    registration: sms.registrationSuccessful({ name: name || 'Test', estateName: 'Test Estate', houseNumber: 'A12', section: 'Lower', court: 'Dam Court', street: 'G1' }),
    approved: sms.householdApproved({ name: name || 'Test', estateName: 'Test Estate', urn: 'TEST-1234', takeOnBalance: 2500 }),
    payment: sms.paymentSuccessful({ name: name || 'Test', amount: 1000, receipt: 'TEST123', estateName: 'Test Estate', balance: 0 }),
  };
  const message = map[kind] || 'Test SMS';
  const result = await queueSms(phone, message, { kind: `test_${kind || 'generic'}` });
  res.json(result);
});

module.exports = router;
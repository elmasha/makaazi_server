// payments/mpesaStkPush.js
const express = require('express');
const router = express.Router();
const request = require('request');
const db = require('../config/db');
const { sendNotification } = require('../utils/notify');

// ============================================================
// CONFIG
// ============================================================
const BASE_URL = process.env.BASE_URL || 'https://makaaziserver22.up.railway.app';
const SHORT_CODE = process.env.MPESA_SHORTCODE || '174379';
const PASS_KEY =
  process.env.MPESA_PASSKEY ||
  'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
const CONSUMER_KEY = process.env.MP_CONSUMER_KEY_DEV;
const CONSUMER_SECRET = process.env.MP_SECRET_KEY_DEV;
const DARAJA_BASE =
  process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

// ============================================================
// HELPERS
// ============================================================
function timestamp() {
  return new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
}

function normalizePhone(raw) {
  let phone = String(raw || '').replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '254' + phone.slice(1);
  if (!phone.startsWith('254')) phone = '254' + phone;
  return phone;
}

/**
 * Promisified request — keeps the "request" package but gives us async/await.
 * Returns: { statusCode, body } where body is parsed if JSON.
 */
function httpRequest(options) {
  return new Promise((resolve, reject) => {
    request(options, (error, response, body) => {
      if (error) return reject(error);
      resolve({
        statusCode: response?.statusCode,
        body,
        headers: response?.headers,
      });
    });
  });
}

// Convenience wrappers
function httpGet(url, headers = {}) {
  return httpRequest({ url, method: 'GET', headers, json: true });
}
function httpPost(url, body, headers = {}) {
  return httpRequest({ url, method: 'POST', headers, json: body });
}

// ============================================================
// MIDDLEWARE — Daraja OAuth token
// ============================================================
async function access(req, res, next) {
  try {
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    const { body } = await httpGet(
      `${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`,
      { Authorization: `Basic ${auth}` }
    );
    if (!body || !body.access_token) {
      throw new Error('No access_token in Daraja response');
    }
    req.access_token = body.access_token;
    next();
  } catch (err) {
    console.error('❌ Daraja access_token error:', err.message || err);
    res.status(500).json({ error: 'Failed to get M-Pesa access token' });
  }
}

// ============================================================
// GET /payment/access_token
// ============================================================
router.get('/access_token', access, (req, res) => {
  res.status(200).json({ access_token: req.access_token });
});

// ============================================================
// GET /payment/
// ============================================================
router.get('/', (req, res) => {
  res.status(200).send({ message: 'payments' });
});

// ============================================================
// POST /payment/mpesa_stk_push — household payment
// ============================================================
router.post('/mpesa_stk_push', access, async (req, res) => {
  const {
    phone,
    amount,
    uid,
    household_id,
    estate_id,
    charge_id,
    transaction_type,
    user_name,
    month,
    year,
  } = req.body;

  // Validate
  const missing = [];
  if (!phone) missing.push('phone');
  if (!amount) missing.push('amount');
  if (!household_id) missing.push('household_id');
  if (!estate_id) missing.push('estate_id');
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  const phoneNormalized = normalizePhone(phone);
  if (phoneNormalized.length !== 12) {
    return res.status(400).json({ error: 'Invalid phone number — use 2547XXXXXXXX' });
  }

  const amountNum = Number(amount);
  if (!amountNum || amountNum < 1) {
    return res.status(400).json({ error: 'Amount must be at least 1 KES' });
  }

  const ts = timestamp();
  const password = Buffer.from(`${SHORT_CODE}${PASS_KEY}${ts}`).toString('base64');

  try {
    const { body: darajaResp } = await httpPost(
      `${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: SHORT_CODE,
        Password: password,
        Timestamp: ts,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amountNum),
        PartyA: phoneNormalized,
        PartyB: SHORT_CODE,
        PhoneNumber: phoneNormalized,
        CallBackURL: `${BASE_URL}/payment/stk_callback`,
        AccountReference: 'Makaazi Payment',
        TransactionDesc: 'Estate service payment',
      },
      { Authorization: `Bearer ${req.access_token}` }
    );

    console.log('🔵 Daraja STK response:', darajaResp);

    if (darajaResp?.CheckoutRequestID) {
      await db.promise().query(
        `INSERT INTO pending_stk_pushes
           (checkout_request_id, merchant_request_id, household_id, estate_id,
            charge_id, uid, user_name, phone, amount, transaction_type, month, year, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
         ON DUPLICATE KEY UPDATE checkout_request_id = VALUES(checkout_request_id)`,
        [
          darajaResp.CheckoutRequestID,
          darajaResp.MerchantRequestID || null,
          household_id,
          estate_id,
          charge_id || null,
          uid || null,
          user_name || null,
          phoneNormalized,
          amountNum,
          transaction_type || null,
          month || null,
          year || null,
        ]
      );
      console.log('💾 Pending push stored:', darajaResp.CheckoutRequestID);
    }

    return res.status(200).json(darajaResp);
  } catch (err) {
    console.error('❌ STK push error:', err.message || err);
    return res.status(500).json({
      error: 'Failed to initiate STK push',
      detail: err.message || 'Unknown error',
    });
  }
});

// ============================================================
// POST /payment/stk_callback — Daraja household callback
// ============================================================
router.post('/stk_callback', async (req, res) => {
  console.log('.......... STK Callback ..................');

  const callback = req.body?.Body?.stkCallback;
  const metadata = callback?.CallbackMetadata;

  if (!callback) {
    console.warn('⚠️ Malformed callback');
    return res.status(200).json({ message: 'Ignored' });
  }

  const checkoutRequestId = callback.CheckoutRequestID;
  const resultCode = callback.ResultCode;

  if (resultCode !== 0 || !metadata) {
    console.log(`⚠️ STK failed/cancelled: ${resultCode} — ${callback.ResultDesc}`);
    if (checkoutRequestId) {
      await db.promise().query(
        `UPDATE pending_stk_pushes SET status = 'Failed' WHERE checkout_request_id = ?`,
        [checkoutRequestId]
      );
    }
    return res.status(200).json({ message: 'Acknowledged' });
  }

  const find = (name) => metadata.Item.find((i) => i.Name === name)?.Value;
  const amount = find('Amount');
  const transID = find('MpesaReceiptNumber');
  const phoneNumber = find('PhoneNumber');
  const transdate = new Date();

  if (!transID) {
    console.warn('⚠️ Callback missing MpesaReceiptNumber');
    return res.status(200).json({ message: 'Acknowledged' });
  }

  const [pendingRows] = await db.promise().query(
    `SELECT * FROM pending_stk_pushes WHERE checkout_request_id = ? LIMIT 1`,
    [checkoutRequestId]
  );

  if (!pendingRows.length) {
    console.warn('⚠️ No pending push found for', checkoutRequestId);
    return res.status(200).json({ message: 'Ignored — no matching pending push' });
  }

  const pending = pendingRows[0];

  const [dupe] = await db.promise().query(
    `SELECT payment_id FROM payments WHERE transaction_id = ? LIMIT 1`,
    [transID]
  );
  if (dupe.length) {
    console.log('ℹ️ Duplicate callback — already recorded:', transID);
    await db.promise().query(
      `UPDATE pending_stk_pushes SET status = 'Completed' WHERE id = ?`,
      [pending.id]
    );
    return res.status(200).json({ message: 'Already recorded' });
  }

  try {
    await db.promise().query(
      `INSERT INTO payments
         (household_id, charge_id, payment_date, amount_paid,
          payment_method, transaction_id, receipt_url, payment_status, estate_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pending.household_id,
        pending.charge_id,
        transdate,
        amount || pending.amount,
        'Mpesa',
        transID,
        null,
        'Completed',
        pending.estate_id,
      ]
    );
    console.log('✅ Payment saved for household', pending.household_id);

    await db.promise().query(
      `UPDATE pending_stk_pushes SET status = 'Completed' WHERE id = ?`,
      [pending.id]
    );
  } catch (err) {
    console.error('❌ Insert payment error:', err.message);
    return res.status(200).json({ message: 'Acknowledged' });
  }

  // Update household_payments month column + totals
  try {
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                        'july', 'august', 'september', 'october', 'november', 'december'];
    const now = new Date();
    const monthKey = monthNames[now.getMonth()];
    const yearVal = now.getFullYear();

    let [hpRows] = await db.promise().query(
      `SELECT * FROM household_payments
       WHERE household_id = ? AND year = ? LIMIT 1`,
      [pending.household_id, yearVal]
    );

    if (!hpRows.length) {
      await db.promise().query(
        `INSERT INTO household_payments
           (household_id, estate_id, full_name, section, street, court,
            year, balance_brought_forward, uid)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          pending.household_id,
          pending.estate_id,
          pending.user_name || '',
          '', '', '',
          yearVal,
          pending.uid || null,
        ]
      );
      [hpRows] = await db.promise().query(
        `SELECT * FROM household_payments
         WHERE household_id = ? AND year = ? LIMIT 1`,
        [pending.household_id, yearVal]
      );
    }

    if (hpRows.length) {
      const row = hpRows[0];
      const currentMonth = Number(row[monthKey] || 0);
      const newMonthVal = currentMonth + Number(amount || pending.amount);
      const newTotal = Number(row.total_paid || 0) + Number(amount || pending.amount);
      const monthsEq = pending.amount > 0
        ? Number((newTotal / Number(pending.amount || 1)).toFixed(2))
        : 0;

      await db.promise().query(
        `UPDATE household_payments
         SET ${monthKey} = ?, total_paid = ?, months_equivalent = ?
         WHERE id = ?`,
        [newMonthVal, newTotal, monthsEq, row.id]
      );
      console.log('✅ household_payments updated');
    }
  } catch (err) {
    console.error('⚠️ household_payments update failed:', err.message);
  }

  try {
    await sendNotification({
      user_uid: pending.uid || String(pending.household_id),
      user_type: 'USER',
      title: 'Payment Received',
      message: `Your payment of KES ${amount || pending.amount} has been received.`,
      type: 'PAYMENT',
    });
  } catch (err) {
    console.warn('⚠️ Notification failed:', err.message);
  }

  return res.status(200).json({ message: 'Payment saved successfully' });
});

// ============================================================
// POST /payment/stk_query — poll STK push status
// ============================================================
router.post('/stk_query', access, async (req, res) => {
  const { checkout_request_id } = req.body;

  if (!checkout_request_id) {
    return res.status(400).json({ error: 'checkout_request_id is required' });
  }

  try {
    const [pendingRows] = await db.promise().query(
      `SELECT * FROM pending_stk_pushes WHERE checkout_request_id = ? LIMIT 1`,
      [checkout_request_id]
    );

    if (pendingRows.length) {
      const p = pendingRows[0];
      if (p.status === 'Completed') {
        return res.json({
          result_code: '0',
          result_desc: 'Payment received',
          mpesa_status: 'success',
        });
      }
      if (p.status === 'Failed') {
        return res.json({
          result_code: '1032',
          result_desc: 'Payment cancelled or failed',
          mpesa_status: 'failed',
        });
      }
    }

    const ts = timestamp();
    const password = Buffer.from(`${SHORT_CODE}${PASS_KEY}${ts}`).toString('base64');

    const { body: darajaResp } = await httpPost(
      `${DARAJA_BASE}/mpesa/stkpushquery/v1/query`,
      {
        BusinessShortCode: SHORT_CODE,
        Password: password,
        Timestamp: ts,
        CheckoutRequestID: checkout_request_id,
      },
      { Authorization: `Bearer ${req.access_token}` }
    );

    console.log('🔵 STK query Daraja resp:', darajaResp);

    const resultCode = String(darajaResp?.ResultCode ?? darajaResp?.errorCode ?? '');
    const resultDesc = darajaResp?.ResultDesc || darajaResp?.errorMessage || '';
    let mpesaStatus = 'pending';

    if (resultCode === '0') mpesaStatus = 'success';
    else if (['1032', '2001', '1', '1001', '1002'].includes(resultCode))
      mpesaStatus = 'failed';
    else if (['1037', '500.001.1001'].includes(resultCode))
      mpesaStatus = 'pending';

    return res.json({
      result_code: resultCode,
      result_desc: resultDesc,
      mpesa_status: mpesaStatus,
    });
  } catch (err) {
    console.error('❌ STK query error:', err.message || err);
    return res.status(500).json({ error: 'Query failed' });
  }
});

// ============================================================
// POST /payment/trans_status — query M-Pesa receipt status
// ============================================================
router.post('/trans_status', access, async (req, res) => {
  const { mpesaID } = req.body;

  if (!mpesaID) {
    return res.status(400).json({ error: 'mpesaID is required' });
  }

  const securityCredential = process.env.MPESA_SECURITY_CREDENTIAL;
  if (!securityCredential) {
    return res.status(500).json({ error: 'MPESA_SECURITY_CREDENTIAL not configured' });
  }

  try {
    const { body } = await httpPost(
      `${DARAJA_BASE}/mpesa/transactionstatus/v1/query`,
      {
        Initiator: process.env.MPESA_INITIATOR || 'testapi',
        SecurityCredential: securityCredential,
        CommandID: 'TransactionStatusQuery',
        TransactionID: mpesaID,
        PartyA: SHORT_CODE,
        IdentifierType: '4',
        QueueTimeOutURL: `${BASE_URL}/payment/timeout_status`,
        ResultURL: `${BASE_URL}/payment/result_status`,
        Remarks: 'OK',
        Occasion: 'OK',
      },
      { Authorization: `Bearer ${req.access_token}` }
    );
    return res.status(200).json(body);
  } catch (err) {
    console.error('❌ trans_status error:', err.message || err);
    return res.status(500).json({ error: 'Transaction status query failed' });
  }
});

// ============================================================
// POST /payment/timeout_status, /result_status
// ============================================================
router.post('/timeout_status', (req, res) => {
  console.log('.......... Timeout status ..................');
  console.log(req.body);
  return res.status(200).json(req.body?.Body || {});
});

router.post('/result_status', (req, res) => {
  console.log('.......... Results status ..................');
  console.log(req.body?.Result || req.body);
  return res.status(200).json(req.body);
});

// ============================================================
// POST /payment/stk_push_subscription — SaaS subscription STK
// ============================================================
router.post('/stk_push_subscription', access, async (req, res) => {
  const { estate_id, phone_number } = req.body;

  if (!estate_id || !phone_number) {
    return res.status(400).json({ error: 'estate_id and phone_number are required' });
  }

  const phoneNormalized = normalizePhone(phone_number);

  try {
    const [[{ count }]] = await db.promise().query(
      'SELECT COUNT(*) as count FROM households WHERE estate_id = ?',
      [estate_id]
    );

    const [plans] = await db.promise().query(
      `SELECT plan_id, monthly_rate
       FROM subscription_plans
       WHERE ? >= min_households
         AND (? <= max_households OR max_households IS NULL)
       ORDER BY min_households DESC
       LIMIT 1`,
      [count, count]
    );

    if (!plans.length) {
      return res.status(400).json({ error: 'No matching subscription plan found' });
    }

    const plan = plans[0];
    const amount = Number(plan.monthly_rate);

    const ts = timestamp();
    const password = Buffer.from(`${SHORT_CODE}${PASS_KEY}${ts}`).toString('base64');

    const { body: darajaResp } = await httpPost(
      `${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: SHORT_CODE,
        Password: password,
        Timestamp: ts,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: phoneNormalized,
        PartyB: SHORT_CODE,
        PhoneNumber: phoneNormalized,
        CallBackURL: `${BASE_URL}/payment/subscription_callback`,
        AccountReference: 'Makaazi Subscription',
        TransactionDesc: 'Estate subscription payment',
      },
      { Authorization: `Bearer ${req.access_token}` }
    );

    console.log('🔵 Subscription STK:', darajaResp);

    if (darajaResp?.CheckoutRequestID) {
      await db.promise().query(
        `INSERT INTO pending_stk_pushes
           (checkout_request_id, merchant_request_id, household_id, estate_id,
            charge_id, uid, user_name, phone, amount, transaction_type, month, year, status)
         VALUES (?, ?, 0, ?, NULL, NULL, 'SUBSCRIPTION', ?, ?, 'subscription', NULL, NULL, 'Pending')
         ON DUPLICATE KEY UPDATE checkout_request_id = VALUES(checkout_request_id)`,
        [
          darajaResp.CheckoutRequestID,
          darajaResp.MerchantRequestID || null,
          estate_id,
          phoneNormalized,
          amount,
        ]
      );
    }

    return res.status(200).json(darajaResp);
  } catch (err) {
    console.error('❌ Subscription STK error:', err.message || err);
    return res.status(500).json({ error: 'Subscription STK push failed' });
  }
});

// ============================================================
// POST /payment/subscription_callback
// ============================================================
router.post('/subscription_callback', async (req, res) => {
  console.log('.......... Subscription Callback ..................');

  const callback = req.body?.Body?.stkCallback;
  const metadata = callback?.CallbackMetadata;

  if (callback?.ResultCode !== 0 || !metadata) {
    return res.status(200).json({ message: 'Acknowledged' });
  }

  const find = (name) => metadata.Item.find((i) => i.Name === name)?.Value;
  const amount = find('Amount');
  const transID = find('MpesaReceiptNumber');

  if (!transID) {
    return res.status(200).json({ message: 'Acknowledged' });
  }

  const [pendingRows] = await db.promise().query(
    `SELECT * FROM pending_stk_pushes WHERE checkout_request_id = ? LIMIT 1`,
    [callback.CheckoutRequestID]
  );

  if (!pendingRows.length) {
    console.warn('⚠️ Subscription callback — no pending row');
    return res.status(200).json({ message: 'Ignored' });
  }

  const pending = pendingRows[0];
  const estate_id = pending.estate_id;

  const [[{ count }]] = await db.promise().query(
    'SELECT COUNT(*) as count FROM households WHERE estate_id = ?',
    [estate_id]
  );

  const [plans] = await db.promise().query(
    `SELECT plan_id FROM subscription_plans
     WHERE ? >= min_households
       AND (? <= max_households OR max_households IS NULL)
     ORDER BY min_households DESC
     LIMIT 1`,
    [count, count]
  );
  const plan_id = plans[0]?.plan_id || null;

  try {
    await db.promise().query(
      `INSERT INTO subscription_payments
         (estate_id, total_households, billing_rate, total_amount,
          payment_method, transaction_id, payment_date, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [estate_id, count, amount, amount, 'Mpesa', transID, new Date(), 'Completed']
    );

    await db.promise().query(
      `INSERT INTO estate_subscriptions
         (estate_id, plan_id, start_date, end_date, amount_paid,
          payment_status, payment_method, transaction_id, receipt_url,
          created_at, updated_at, is_active)
       VALUES (?, ?, CURDATE(), NULL, ?, 'Paid', 'Mpesa', ?, NULL, NOW(), NOW(), 1)
       ON DUPLICATE KEY UPDATE
         plan_id = VALUES(plan_id),
         start_date = CURDATE(),
         end_date = NULL,
         amount_paid = VALUES(amount_paid),
         payment_status = 'Paid',
         payment_method = 'Mpesa',
         transaction_id = VALUES(transaction_id),
         updated_at = CURRENT_TIMESTAMP,
         is_active = 1`,
      [estate_id, plan_id, amount, transID]
    );

    await db.promise().query(
      `UPDATE pending_stk_pushes SET status = 'Completed' WHERE id = ?`,
      [pending.id]
    );
  } catch (err) {
    console.error('❌ Subscription callback DB error:', err.message);
    return res.status(200).json({ message: 'Acknowledged' });
  }

  try {
    await sendNotification({
      user_uid: String(estate_id),
      user_type: 'ESTATE',
      title: 'Subscription Received',
      message: `KES ${amount} subscription payment received.`,
      type: 'PAYMENT',
    });
  } catch (err) {
    console.warn('⚠️ Notification failed:', err.message);
  }

  return res.status(200).json({ message: 'Subscription recorded' });
});

// ============================================================
// POST /payment/stk_push_subscription/query
// ============================================================
router.post('/stk_push_subscription/query', access, async (req, res) => {
  const { checkoutRequestId } = req.body;

  if (!checkoutRequestId) {
    return res.status(400).json({ error: 'checkoutRequestId is required' });
  }

  try {
    const ts = timestamp();
    const password = Buffer.from(`${SHORT_CODE}${PASS_KEY}${ts}`).toString('base64');

    const { body } = await httpPost(
      `${DARAJA_BASE}/mpesa/stkpushquery/v1/query`,
      {
        BusinessShortCode: SHORT_CODE,
        Password: password,
        Timestamp: ts,
        CheckoutRequestID: checkoutRequestId,
      },
      { Authorization: `Bearer ${req.access_token}` }
    );

    return res.status(200).json(body);
  } catch (err) {
    console.error('❌ Subscription query error:', err.message || err);
    return res.status(500).json({ error: 'Query failed' });
  }
});

// ============================================================
// POST /payment/subscription/initiate
// ============================================================
router.post('/subscription/initiate', async (req, res) => {
  const { estate_id } = req.body;

  if (!estate_id) {
    return res.status(400).json({ error: 'estate_id is required' });
  }

  try {
    const [[{ count }]] = await db.promise().query(
      'SELECT COUNT(*) as count FROM households WHERE estate_id = ?',
      [estate_id]
    );

    const [plans] = await db.promise().query(
      `SELECT plan_id, monthly_rate FROM subscription_plans
       WHERE ? >= min_households
         AND (? <= max_households OR max_households IS NULL)
       ORDER BY min_households DESC LIMIT 1`,
      [count, count]
    );

    const rate = plans[0]?.monthly_rate || 0;

    res.json({
      estate_id,
      total_households: count,
      billing_rate: rate,
      message: `Subscription for Ksh ${rate} initiated.`,
    });
  } catch (err) {
    console.error('❌ Subscription initiate error:', err.message);
    res.status(500).json({ error: 'Failed to compute subscription info' });
  }
});

module.exports = router;
// controllers/householdApprovalController.js
const db = require('../config/db');
const redisClient = require('../config/redis');
const { sendNotification } = require('../utils/notify');
const { generateHouseholdUrn } = require('../utils/billing');
const { queueSms } = require('../services/smsService');
const sms = require('../services/smsTemplates');

// ==================================================================
// SELF-REGISTRATION (resident side)
// ==================================================================

/**
 * POST /households/register
 * Public (or Firebase-authenticated resident).
 * Always creates household with status='Pending'.
 * Fires: registrationSuccessful (to resident), new-registration alert (to officials)
 */
exports.registerHousehold = async (req, res) => {
  const {
    estate_id,
    primary_owner,
    contact_number,
    residence_status,
    section,
    court,
    street,
    house_number = null,
    spouse_name = null,
    spouse_contact = null,
    caretaker_name = null,
    caretaker_contact = null,
    take_on_balance = 0,
    uid = null,
  } = req.body;

  const missing = [];
  if (!estate_id)        missing.push('estate_id');
  if (!primary_owner)    missing.push('primary_owner');
  if (!contact_number)   missing.push('contact_number');
  if (!residence_status) missing.push('residence_status');
  if (!section)          missing.push('section');
  if (!court)            missing.push('court');
  if (!street)           missing.push('street');

  if (missing.length) {
    return res.status(400).json({
      error: `Missing required fields: ${missing.join(', ')}`,
    });
  }

  if (residence_status === 'Non-resident' && !caretaker_name) {
    return res.status(400).json({
      error: 'Caretaker name is required when residence status is Non-resident',
    });
  }

  const tob = Number(take_on_balance) || 0;
  if (tob < 0) {
    return res.status(400).json({ error: 'take_on_balance must be >= 0' });
  }

  try {
    // 1. Estate exists
    const [estates] = await db.promise().query(
      `SELECT estate_id, estate_urn, estate_name
       FROM estates WHERE estate_id = ? LIMIT 1`,
      [estate_id]
    );
    if (!estates.length) {
      return res.status(404).json({ error: 'Estate not found' });
    }
    const estate = estates[0];

    // 2. Duplicate phone check
    const [dupe] = await db.promise().query(
      `SELECT household_id, status FROM households
       WHERE contact_number = ? AND estate_id = ? LIMIT 1`,
      [contact_number, estate_id]
    );
    if (dupe.length) {
      const s = dupe[0].status;
      const msg =
        s === 'Pending'  ? 'A registration for this number is already awaiting approval' :
        s === 'Approved' ? 'This number is already registered in this estate' :
                           'A registration for this number was previously rejected';
      return res.status(409).json({ error: msg, existing_status: s });
    }

    // 3. URN generation
    let householdUrn = uid;
    if (!householdUrn) {
      let collision = true;
      let attempts = 0;
      while (collision && attempts < 5) {
        householdUrn = generateHouseholdUrn(estate.estate_urn);
        const [c] = await db.promise().query(
          `SELECT 1 FROM households WHERE uid = ? LIMIT 1`,
          [householdUrn]
        );
        collision = c.length > 0;
        attempts++;
      }
      if (collision) {
        return res.status(500).json({ error: 'Failed to generate unique URN' });
      }
    } else {
      const [uidTaken] = await db.promise().query(
        `SELECT 1 FROM households WHERE uid = ? LIMIT 1`,
        [uid]
      );
      if (uidTaken.length) {
        return res.status(409).json({ error: 'This account is already registered' });
      }
    }

    // 4. Insert as Pending
    const insertSql = `
      INSERT INTO households (
        estate_id, uid, primary_owner, spouse_name, caretaker_name,
        residence_status, contact_number, house_number,
        section, court, street,
        is_official, official_role, active,
        status, take_on_balance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 1, 'Pending', ?)
    `;
    const values = [
      estate_id, householdUrn, primary_owner, spouse_name, caretaker_name,
      residence_status, contact_number, house_number,
      section, court, street,
      tob,
    ];
    const [result] = await db.promise().query(insertSql, values);

    // 5. In-app notifications to officials
    const [officials] = await db.promise().query(
      `SELECT uid, full_name, contact_number FROM officials WHERE estate_id = ?`,
      [estate_id]
    );
    for (const off of officials) {
      try {
        await sendNotification({
          user_uid: off.uid,
          user_type: 'USER',
          title: 'New Household Registration',
          message: `${primary_owner} (${section} / ${court} / ${street}) has requested to join ${estate.estate_name}.`,
          type: 'ACCOUNT',
        });
      } catch (e) {
        console.warn('Officials notification failed:', e.message);
      }
    }

    // 6. Invalidate cache
    await redisClient.del(`estate:${estate_id}:pending`);

    // ---- SMS (fire-and-forget) ----
    (async () => {
      try {
        // A. Confirm to the resident
        if (contact_number) {
          const res1 = await queueSms(
            contact_number,
            sms.registrationSuccessful({
              name: (primary_owner || 'Resident').split(' ')[0],
              estateName: estate.estate_name,
              houseNumber: house_number,
              section,
              court,
              street,
            }),
            {
              user_uid: householdUrn,
              estate_id,
              kind: 'registration_successful',
            }
          );
          console.log('🟢 registrationSuccessful →', res1);
        }

        // B. Alert each official
        const addr = [house_number && `Hs ${house_number}`, section, court, street]
          .filter(Boolean)
          .join(' / ');

        for (const off of officials) {
          if (!off.contact_number) continue;
          const res2 = await queueSms(
            off.contact_number,
            `Hi ${(off.full_name || 'Official').split(' ')[0]}, ${primary_owner} (${
              addr || 'no address'
            }) has requested to join ${estate.estate_name}. Open Makaazi to approve.`,
            {
              estate_id,
              kind: 'new_registration_for_official',
            }
          );
          console.log('🟢 newRegistrationForOfficial →', res2);
          await new Promise((r) => setTimeout(r, 100));
        }
      } catch (e) {
        console.warn('registerHousehold SMS failed:', e.message);
      }
    })();

    return res.status(201).json({
      message: 'Registration submitted. Awaiting official approval.',
      household_id: result.insertId,
      urn: householdUrn,
      status: 'Pending',
    });
  } catch (err) {
    console.error('registerHousehold error:', err.message);
    return res.status(500).json({ error: 'Registration failed' });
  }
};

/**
 * GET /households/registration-status/:uid
 */
exports.getRegistrationStatus = async (req, res) => {
  const { uid } = req.params;
  try {
    const [rows] = await db.promise().query(
      `SELECT household_id, uid, primary_owner, status,
              approved_at, rejection_reason, estate_id
       FROM households WHERE uid = ? LIMIT 1`,
      [uid]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'No registration found for this account' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('getRegistrationStatus error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ==================================================================
// OFFICIAL-SIDE: LIST PENDING
// ==================================================================
exports.getPendingHouseholds = async (req, res) => {
  const { estateId } = req.params;
  const cacheKey = `estate:${estateId}:pending`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT
         household_id, uid, primary_owner, spouse_name, caretaker_name,
         residence_status, contact_number, house_number,
         section, court, street,
         take_on_balance, created_at
       FROM households
       WHERE estate_id = ? AND status = 'Pending'
       ORDER BY created_at ASC`,
      [estateId]
    );

    await redisClient.setEx(cacheKey, 60, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getPendingHouseholds error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch pending households' });
  }
};

// ==================================================================
// OFFICIAL-SIDE: APPROVE
// ==================================================================
/**
 * POST /households/:householdId/approve
 * Body: { official_uid }
 * Fires: householdApproved (to resident)
 */
exports.approveHousehold = async (req, res) => {
  const { householdId } = req.params;
  const { official_uid } = req.body;

  if (!official_uid) {
    return res.status(400).json({ error: 'official_uid is required' });
  }

  try {
    const [hRows] = await db.promise().query(
      `SELECT * FROM households WHERE household_id = ? LIMIT 1`,
      [householdId]
    );
    if (!hRows.length) return res.status(404).json({ error: 'Household not found' });
    const household = hRows[0];

    if (household.status === 'Approved') {
      return res.status(200).json({ message: 'Already approved' });
    }

    // Verify official
    const [oRows] = await db.promise().query(
      `SELECT official_id, full_name FROM officials
       WHERE uid = ? AND estate_id = ? LIMIT 1`,
      [official_uid, household.estate_id]
    );
    if (!oRows.length) {
      return res.status(403).json({ error: 'You are not an official of this estate' });
    }
    const official = oRows[0];

    // Transaction: approve + seed household_payments
    const connection = await db.promise().getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `UPDATE households
         SET status = 'Approved',
             approved_by = ?,
             approved_at = NOW()
         WHERE household_id = ?`,
        [official.official_id, householdId]
      );

      const year = new Date().getFullYear();
      await connection.query(
        `INSERT INTO household_payments (
           household_id, estate_id, full_name,
           section, street, court,
           year, balance_brought_forward, uid
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           full_name = VALUES(full_name),
           section = VALUES(section),
           street = VALUES(street),
           court = VALUES(court),
           balance_brought_forward = VALUES(balance_brought_forward),
           updated_at = CURRENT_TIMESTAMP`,
        [
          household.household_id,
          household.estate_id,
          household.primary_owner,
          household.section,
          household.street,
          household.court,
          year,
          household.take_on_balance,
          household.uid,
        ]
      );

      await connection.commit();
    } catch (txErr) {
      await connection.rollback();
      throw txErr;
    } finally {
      connection.release();
    }

    // Invalidate caches
    const estateId = household.estate_id;
    await Promise.all([
      redisClient.del(`estate:${estateId}:pending`),
      redisClient.del(`households:estate:${estateId}`),
      redisClient.del('households:all'),
      redisClient.del('households'),
      redisClient.del(`household:uid:${household.uid}`),
      redisClient.del(`household:pk:${household.household_id}`),
      redisClient.del(`dashboard:${household.uid}`),
    ]);

    // In-app notification
    try {
      await sendNotification({
        user_uid: household.uid,
        user_type: 'USER',
        title: 'Registration Approved',
        message: `Welcome! Your registration for ${household.section} / ${household.court} is approved.`,
        type: 'ACCOUNT',
      });
    } catch (e) {
      console.warn('Approval notification failed:', e.message);
    }

    // ---- SMS (fire-and-forget) ----
    (async () => {
      try {
        if (household.contact_number) {
          const [[est]] = await db.promise().query(
            `SELECT estate_name FROM estates WHERE estate_id = ?`,
            [estateId]
          );

          const result = await queueSms(
            household.contact_number,
            sms.householdApproved({
              name: (household.primary_owner || 'Resident').split(' ')[0],
              estateName: est?.estate_name || 'your estate',
              urn: household.uid,
              takeOnBalance: household.take_on_balance,
            }),
            {
              user_uid: household.uid,
              estate_id: estateId,
              kind: 'household_approved',
            }
          );
          console.log('🟢 householdApproved →', result);
        }
      } catch (e) {
        console.warn('Approval SMS failed:', e.message);
      }
    })();

    return res.json({
      message: 'Household approved',
      household_id: household.household_id,
      urn: household.uid,
      approved_by: official.full_name,
      approved_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('approveHousehold error:', err.message);
    return res.status(500).json({ error: 'Approval failed' });
  }
};

// ==================================================================
// OFFICIAL-SIDE: REJECT
// ==================================================================
/**
 * POST /households/:householdId/reject
 * Body: { official_uid, reason }
 * Fires: registrationRejected (to resident)
 */
exports.rejectHousehold = async (req, res) => {
  const { householdId } = req.params;
  const { official_uid, reason } = req.body;

  if (!official_uid) return res.status(400).json({ error: 'official_uid is required' });
  if (!reason)       return res.status(400).json({ error: 'reason is required' });

  try {
    const [hRows] = await db.promise().query(
      `SELECT * FROM households WHERE household_id = ? LIMIT 1`,
      [householdId]
    );
    if (!hRows.length) return res.status(404).json({ error: 'Household not found' });
    const household = hRows[0];

    const [oRows] = await db.promise().query(
      `SELECT official_id, estate_id FROM officials WHERE uid = ? LIMIT 1`,
      [official_uid]
    );
    if (!oRows.length || oRows[0].estate_id !== household.estate_id) {
      return res.status(403).json({ error: 'Not authorized for this estate' });
    }

    await db.promise().query(
      `UPDATE households
       SET status = 'Rejected',
           approved_by = ?,
           approved_at = NOW(),
           rejection_reason = ?
       WHERE household_id = ?`,
      [oRows[0].official_id, reason, householdId]
    );

    await Promise.all([
      redisClient.del(`estate:${household.estate_id}:pending`),
      redisClient.del(`household:uid:${household.uid}`),
      redisClient.del(`household:pk:${household.household_id}`),
    ]);

    try {
      await sendNotification({
        user_uid: household.uid,
        user_type: 'USER',
        title: 'Registration Rejected',
        message: `Your registration was rejected: ${reason}`,
        type: 'ACCOUNT',
      });
    } catch (e) {
      console.warn('Rejection notification failed:', e.message);
    }

    // ---- SMS (fire-and-forget) ----
    (async () => {
      try {
        if (household.contact_number) {
          const [[est]] = await db.promise().query(
            `SELECT estate_name FROM estates WHERE estate_id = ?`,
            [household.estate_id]
          );

          const result = await queueSms(
            household.contact_number,
            `Hi ${(household.primary_owner || 'Applicant').split(' ')[0]}, your registration at ${
              est?.estate_name || 'the estate'
            } was not approved. Reason: ${reason}. Contact your estate officials for more info. - Makaazi`,
            {
              user_uid: household.uid,
              estate_id: household.estate_id,
              kind: 'registration_rejected',
            }
          );
          console.log('🟢 registrationRejected →', result);
        }
      } catch (e) {
        console.warn('Rejection SMS failed:', e.message);
      }
    })();

    return res.json({ message: 'Household rejected' });
  } catch (err) {
    console.error('rejectHousehold error:', err.message);
    return res.status(500).json({ error: 'Rejection failed' });
  }
};
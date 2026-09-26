// controllers/householdsController.js
const db = require('../config/db');
const redisClient = require('../config/redis');
const { generateHouseholdUrn } = require('../utils/billing');
const { sendNotification } = require('../utils/notify');
const { queueSms } = require('../services/smsService');
const sms = require('../services/smsTemplates');

// ------------------------------------------------------------------
// Cache keys
// ------------------------------------------------------------------
const CACHE = {
  all:                'households:all',
  byEstate:      (id) => `households:estate:${id}`,
  byAddress: (e, s, st, c) =>
    `households:addr:${e}:${s || 'all'}:${st || 'all'}:${c || 'all'}`,
  byPk:          (pk) => `household:pk:${pk}`,
  byUid:        (uid) => `household:uid:${uid}`,
  byPhone: (e, phone) => `household:phone:${e}:${phone}`,
  searchEstate: (e, q) => `households:search:${e}:${q}`,
  searchAll:       (q) => `households:search:all:${q}`,
  active:     (flag)   => `households:active:${flag}`,
  activeEstate: (flag, e) => `households:active:${flag}:estate:${e}`,
  officials:  (flag)   => `households:officials:${flag}`,
  dropdowns:     (e)   => `estate:${e}:dropdowns`,
};

async function invalidateHouseholdCaches(estateId, pk, uid) {
  const keys = [
    CACHE.all,
    CACHE.byEstate(estateId),
    CACHE.active(0), CACHE.active(1),
    CACHE.activeEstate(0, estateId), CACHE.activeEstate(1, estateId),
    CACHE.officials(0), CACHE.officials(1),
    CACHE.byPk(pk),
    CACHE.byUid(uid),
    CACHE.dropdowns(estateId),
  ];
  await Promise.all(keys.map((k) => redisClient.del(k)));
}

function normalizeBool(v) {
  if (v === 1 || v === '1' || v === true  || v === 'true')  return 1;
  if (v === 0 || v === '0' || v === false || v === 'false') return 0;
  return null;
}

async function fetchEstateName(estateId) {
  try {
    const [[row]] = await db.promise().query(
      `SELECT estate_name FROM estates WHERE estate_id = ?`,
      [estateId]
    );
    return row?.estate_name || 'your estate';
  } catch {
    return 'your estate';
  }
}

// ==================================================================
// READS
// ==================================================================

// GET /households/by-address?estate_id=&section=&street=&court=
exports.getHouseholdsByAddress = async (req, res) => {
  const { estate_id, section, street, court } = req.query;
  if (!estate_id) return res.status(400).json({ error: 'estate_id is required' });

  const cacheKey = CACHE.byAddress(estate_id, section, street, court);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const conditions = ["estate_id = ?", "status = 'Approved'"];
    const values = [estate_id];
    if (section) { conditions.push('section = ?'); values.push(section); }
    if (street)  { conditions.push('street = ?');  values.push(street); }
    if (court)   { conditions.push('court = ?');   values.push(court); }

    const sql = `
      SELECT
        household_id, uid, primary_owner, contact_number, house_number,
        section, street, court, active, status, take_on_balance
      FROM households
      WHERE ${conditions.join(' AND ')}
      ORDER BY section, street, court, house_number
    `;

    const [rows] = await db.promise().query(sql, values);
    await redisClient.setEx(cacheKey, 200, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getHouseholdsByAddress error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch households' });
  }
};

exports.getAllHouseholds = async (req, res) => {
  try {
    const cached = await redisClient.get(CACHE.all);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households ORDER BY created_at DESC`
    );
    await redisClient.setEx(CACHE.all, 60, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getAllHouseholds error:', err.message);
    return res.status(500).json({ error: 'Error getting households' });
  }
};

exports.getHouseholdByUid = async (req, res) => {
  const { uid } = req.params;
  const cacheKey = CACHE.byUid(uid);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households WHERE uid = ? LIMIT 1`,
      [uid]
    );
    if (!rows.length) return res.status(404).json({ message: 'Household not found' });

    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows[0]));
    return res.json(rows[0]);
  } catch (err) {
    console.error('getHouseholdByUid error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.getHouseholdById = async (req, res) => {
  const { id } = req.params;
  const cacheKey = CACHE.byPk(id);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households WHERE household_id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Household not found' });

    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows[0]));
    return res.json(rows[0]);
  } catch (err) {
    console.error('getHouseholdById error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.getHouseholdByPhone = async (req, res) => {
  const { estateId, phone } = req.params;
  const cacheKey = CACHE.byPhone(estateId, phone);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households
       WHERE contact_number = ? AND estate_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [phone, estateId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Household not found' });

    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows[0]));
    return res.json(rows[0]);
  } catch (err) {
    console.error('getHouseholdByPhone error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.searchHouseholdsId = async (req, res) => {
  const { id } = req.params;
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Search query is required' });

  const cacheKey = CACHE.searchEstate(id, query);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const sql = `
      SELECT * FROM households
      WHERE estate_id = ?
        AND status = 'Approved'
        AND (primary_owner LIKE ?
          OR contact_number LIKE ?
          OR house_number LIKE ?
          OR uid LIKE ?)
    `;
    const pat = `%${query}%`;
    const [rows] = await db.promise().query(sql, [id, pat, pat, pat, pat]);

    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('searchHouseholdsId error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.searchHouseholds = async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Search query is required' });

  const cacheKey = CACHE.searchAll(query);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const sql = `
      SELECT * FROM households
      WHERE status = 'Approved'
        AND (primary_owner LIKE ?
          OR contact_number LIKE ?
          OR house_number LIKE ?
          OR uid LIKE ?)
    `;
    const pat = `%${query}%`;
    const [rows] = await db.promise().query(sql, [pat, pat, pat, pat]);

    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('searchHouseholds error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.getActiveHouseHolds = async (req, res) => {
  const flag = normalizeBool(req.params.active);
  if (flag === null) return res.status(400).json({ error: 'active must be 0 or 1' });

  const cacheKey = CACHE.active(flag);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households
       WHERE active = ? AND status = 'Approved'
       ORDER BY created_at DESC`,
      [flag]
    );
    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getActiveHouseHolds error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.getActiveEstate = async (req, res) => {
  const flag = normalizeBool(req.params.active);
  const { estate_id } = req.params;
  if (flag === null || !estate_id) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const cacheKey = CACHE.activeEstate(flag, estate_id);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households
       WHERE active = ? AND estate_id = ? AND status = 'Approved'
       ORDER BY created_at DESC`,
      [flag, estate_id]
    );
    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getActiveEstate error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.getOfficials = async (req, res) => {
  const flag = normalizeBool(req.params.is_official);
  if (flag === null) return res.status(400).json({ error: 'is_official must be 0 or 1' });

  const cacheKey = CACHE.officials(flag);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households
       WHERE is_official = ? AND status = 'Approved'
       ORDER BY created_at DESC`,
      [flag]
    );
    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getOfficials error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.getHsHlByEstateId = async (req, res) => {
  const { id } = req.params;
  const cacheKey = CACHE.byEstate(id);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [rows] = await db.promise().query(
      `SELECT * FROM households
       WHERE estate_id = ? AND status = 'Approved'
       ORDER BY section, court, street, house_number`,
      [id]
    );
    await redisClient.setEx(cacheKey, 300, JSON.stringify(rows));
    return res.json(rows);
  } catch (err) {
    console.error('getHsHlByEstateId error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ==================================================================
// HOUSEHOLD PAYMENTS (per-household transaction log)
// ==================================================================
exports.getHouseholdPayments = async (req, res) => {
  const { householdId } = req.params;
  if (!householdId) return res.status(400).json({ error: 'householdId is required' });

  try {
    const [rows] = await db.promise().query(
      `SELECT payment_id, household_id, estate_id, charge_id,
              amount_paid, payment_method, transaction_id,
              payment_status, payment_date, receipt_url, created_at
       FROM payments
       WHERE household_id = ?
       ORDER BY payment_date DESC, payment_id DESC`,
      [householdId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('getHouseholdPayments error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch payments' });
  }
};

// ==================================================================
// ESTATE HOUSEHOLD LIST
// ==================================================================
exports.getEstateHouseholdList = async (req, res) => {
  const { estateId } = req.params;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  if (!estateId) return res.status(400).json({ error: 'estateId is required' });

  try {
    const [rates] = await db.promise().query(
      `SELECT COALESCE(SUM(amount), 0) AS rate
       FROM service_charges
       WHERE estate_id = ? AND frequency = 'Monthly'`,
      [estateId]
    );
    const monthlyRate = Number(rates[0]?.rate || 0);
    const monthsElapsed = new Date().getMonth() + 1;

    const [rows] = await db.promise().query(
      `SELECT
         h.household_id, h.uid, h.primary_owner, h.contact_number, h.house_number,
         h.section, h.street, h.court, h.active, h.take_on_balance,
         COALESCE(hp.balance_brought_forward, h.take_on_balance, 0) AS bf,
         COALESCE(hp.total_paid, 0) AS total_paid,
         hp.january, hp.february, hp.march, hp.april,
         hp.may, hp.june, hp.july, hp.august,
         hp.september, hp.october, hp.november, hp.december
       FROM households h
       LEFT JOIN household_payments hp
         ON hp.household_id = h.household_id AND hp.year = ?
       WHERE h.estate_id = ? AND h.status = 'Approved'
       ORDER BY h.section, h.court, h.street, h.house_number`,
      [year, estateId]
    );

    const results = rows.map((r) => {
      const bf = Number(r.bf || 0);
      const paid = Number(r.total_paid || 0);
      const dueToDate = bf + monthlyRate * monthsElapsed;
      const overdue = Math.max(0, dueToDate - paid);
      const prepaid = Math.max(0, paid - dueToDate);

      let status = 'Paid';
      if (overdue > 0) status = 'Overdue';
      else if (prepaid > 0) status = 'Prepaid';

      return {
        household_id: r.household_id,
        primary_owner: r.primary_owner,
        contact_number: r.contact_number,
        house_number: r.house_number,
        section: r.section,
        court: r.court,
        street: r.street,
        balance_brought_forward: bf,
        total_paid: paid,
        due_to_date: dueToDate,
        overdue,
        prepaid,
        status,
        months: {
          january:   Number(r.january   || 0),
          february:  Number(r.february  || 0),
          march:     Number(r.march     || 0),
          april:     Number(r.april     || 0),
          may:       Number(r.may       || 0),
          june:      Number(r.june      || 0),
          july:      Number(r.july      || 0),
          august:    Number(r.august    || 0),
          september: Number(r.september || 0),
          october:   Number(r.october   || 0),
          november:  Number(r.november  || 0),
          december:  Number(r.december  || 0),
        },
      };
    });

    return res.json(results);
  } catch (err) {
    console.error('getEstateHouseholdList error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch estate list' });
  }
};

// ==================================================================
// ADDRESS DROPDOWNS
// ==================================================================
exports.getAddressDropdowns = async (req, res) => {
  const { estate_id } = req.params;
  if (!estate_id) return res.status(400).json({ error: 'estate_id is required' });

  const cacheKey = CACHE.dropdowns(estate_id);

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const [sections] = await db.promise().query(
      `SELECT section_name FROM estate_sections
       WHERE estate_id = ? AND active = 1 ORDER BY section_name`,
      [estate_id]
    );
    const [courts] = await db.promise().query(
      `SELECT court_name FROM estate_courts
       WHERE estate_id = ? AND active = 1 ORDER BY court_name`,
      [estate_id]
    );
    const [streets] = await db.promise().query(
      `SELECT street_name FROM estate_streets
       WHERE estate_id = ? AND active = 1 ORDER BY street_name`,
      [estate_id]
    );

    const result = {
      estate_id: Number(estate_id),
      sections: sections.map((r) => r.section_name),
      courts:   courts.map((r) => r.court_name),
      streets:  streets.map((r) => r.street_name),
    };

    await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
    return res.json(result);
  } catch (err) {
    console.error('getAddressDropdowns error:', err.message);
    return res.status(500).json({ error: 'Failed to load address options' });
  }
};

exports.getEstateAddressConfig = async (req, res) => {
  const { estate_id } = req.params;
  try {
    const [rows] = await db.promise().query(
      `SELECT show_street, show_section, show_court
       FROM estate_address_config WHERE estate_id = ? LIMIT 1`,
      [estate_id]
    );
    if (!rows.length) {
      return res.json({ show_street: true, show_section: true, show_court: true });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('getEstateAddressConfig error:', err.message);
    return res.status(500).json({ error: 'Failed to load estate config' });
  }
};

// ==================================================================
// WRITES
// ==================================================================

// POST /households/addHousehold
// Fires: registrationSuccessful (to resident) + new-registration alert (to officials)
exports.createHousehold = async (req, res) => {
  const {
    estate_id, primary_owner, spouse_name = null, caretaker_name = null,
    residence_status, contact_number, house_number = null,
    section, court, street,
    is_official = 0, official_role = null,
    take_on_balance = 0,
    uid,
  } = req.body;

  const missing = [];
  if (!estate_id)        missing.push('estate_id');
  if (!primary_owner)    missing.push('primary_owner');
  if (!residence_status) missing.push('residence_status');
  if (!contact_number)   missing.push('contact_number');
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
  if (tob < 0) return res.status(400).json({ error: 'take_on_balance must be >= 0' });

  try {
    const [estates] = await db.promise().query(
      `SELECT estate_id, estate_urn FROM estates WHERE estate_id = ? LIMIT 1`,
      [estate_id]
    );
    if (!estates.length) return res.status(404).json({ error: 'Estate not found' });

    const [dupe] = await db.promise().query(
      `SELECT household_id FROM households
       WHERE contact_number = ? AND estate_id = ? LIMIT 1`,
      [contact_number, estate_id]
    );
    if (dupe.length) {
      return res.status(409).json({
        error: 'A household with this contact number already exists in this estate',
      });
    }

    let householdUrn = uid || null;
    if (!householdUrn) {
      let collision = true, attempts = 0;
      while (collision && attempts < 5) {
        householdUrn = generateHouseholdUrn(estates[0].estate_urn);
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
    }

    const sql = `
      INSERT INTO households (
        estate_id, uid, primary_owner, spouse_name, caretaker_name,
        residence_status, contact_number, house_number,
        section, court, street,
        is_official, official_role, active,
        status, take_on_balance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Approved', ?)
    `;
    const values = [
      estate_id, householdUrn, primary_owner, spouse_name, caretaker_name,
      residence_status, contact_number, house_number,
      section, court, street,
      is_official ? 1 : 0, official_role, tob,
    ];

    const [result] = await db.promise().query(sql, values);

    const year = new Date().getFullYear();
    await db.promise().query(
      `INSERT INTO household_payments
         (household_id, estate_id, full_name, section, street, court,
          year, balance_brought_forward, uid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         full_name = VALUES(full_name),
         section = VALUES(section),
         street = VALUES(street),
         court = VALUES(court),
         balance_brought_forward = VALUES(balance_brought_forward)`,
      [result.insertId, estate_id, primary_owner, section, street, court,
       year, tob, householdUrn]
    );

    await invalidateHouseholdCaches(estate_id, result.insertId, householdUrn);

    // ---- SMS (fire-and-forget) ----
    (async () => {
      try {
        const estateName = await fetchEstateName(estate_id);

        // 1. Confirmation SMS to the resident who registered
        if (contact_number) {
          await queueSms(
            contact_number,
            sms.registrationSuccessful({
              name: (primary_owner || 'Resident').split(' ')[0],
              estateName,
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
        }

        // 2. Alert every official of this estate
        const [officials] = await db.promise().query(
          `SELECT full_name, contact_number
           FROM officials
           WHERE estate_id = ? AND contact_number IS NOT NULL`,
          [estate_id]
        );

        const addr = [house_number && `Hs ${house_number}`, section, court, street]
          .filter(Boolean)
          .join(' / ');

        for (const o of officials) {
          const msg = `Hi ${(o.full_name || 'Official').split(' ')[0]}, ${primary_owner} (${
            addr || 'no address'
          }) has been added to ${estateName}. Open Makaazi to view.`;

          await queueSms(o.contact_number, msg, {
            estate_id,
            kind: 'new_registration_for_official',
          });
          await new Promise((r) => setTimeout(r, 100));
        }
      } catch (e) {
        console.warn('createHousehold SMS failed:', e.message);
      }
    })();

    return res.status(201).json({
      message: 'Household created successfully',
      householdId: result.insertId,
      urn: householdUrn,
      status: 'Approved',
    });
  } catch (err) {
    console.error('createHousehold error:', err.message);
    return res.status(500).json({ error: 'Failed to create household' });
  }
};

// POST /households/updateRoles/:id
// Fires: officialAssigned (household → official) OR officialPromoted (role change)
exports.updateHouseholdRoles = async (req, res) => {
  const { household_id, is_official, official_role } = req.body;
  if (!household_id) return res.status(400).json({ error: 'household_id is required' });

  try {
    // 1. Get current state BEFORE updating (to detect the transition)
    const [[before]] = await db.promise().query(
      `SELECT household_id, estate_id, uid, primary_owner, contact_number,
              is_official, official_role
       FROM households WHERE household_id = ?`,
      [household_id]
    );
    if (!before) return res.status(404).json({ error: 'Household not found' });

    const newOfficial = is_official ? 1 : 0;

    // 2. Apply the change
    const [result] = await db.promise().query(
      `UPDATE households SET is_official = ?, official_role = ?
       WHERE household_id = ?`,
      [newOfficial, official_role || null, household_id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Household not found' });
    }

    await invalidateHouseholdCaches(before.estate_id, household_id, before.uid);

    // ---- SMS (fire-and-forget) ----
    (async () => {
      try {
        const estateName = await fetchEstateName(before.estate_id);

        const becomingOfficial = !before.is_official && newOfficial === 1;
        const roleChanged =
          before.is_official === 1 &&
          newOfficial === 1 &&
          before.official_role !== (official_role || null);

        if (becomingOfficial && before.contact_number) {
          await queueSms(
            before.contact_number,
            sms.officialAssigned({
              name: (before.primary_owner || 'Resident').split(' ')[0],
              role: official_role || 'Official',
              estateName,
            }),
            {
              user_uid: before.uid,
              estate_id: before.estate_id,
              kind: 'official_assigned',
            }
          );
        } else if (roleChanged && before.contact_number) {
          await queueSms(
            before.contact_number,
            sms.officialPromoted({
              name: (before.primary_owner || 'Official').split(' ')[0],
              oldRole: before.official_role,
              newRole: official_role || 'Official',
              estateName,
            }),
            {
              user_uid: before.uid,
              estate_id: before.estate_id,
              kind: 'official_promoted',
            }
          );
        }
      } catch (e) {
        console.warn('Role-change SMS failed:', e.message);
      }
    })();

    return res.json({ message: 'Household roles updated' });
  } catch (err) {
    console.error('updateHouseholdRoles error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// NEW: POST /households/approve/:id
// Fires: householdApproved
exports.approveHousehold = async (req, res) => {
  const { id } = req.params;
  const { official_id, status, rejection_reason } = req.body;

  if (!official_id || !status) {
    return res.status(400).json({ error: 'official_id and status are required' });
  }
  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be "Approved" or "Rejected"' });
  }

  try {
    const [[official]] = await db.promise().query(
      'SELECT estate_id FROM officials WHERE official_id = ?',
      [official_id]
    );
    const [[hh]] = await db.promise().query(
      'SELECT estate_id FROM households WHERE household_id = ?',
      [id]
    );

    if (!official) return res.status(404).json({ error: 'Official not found' });
    if (!hh) return res.status(404).json({ error: 'Household not found' });
    if (official.estate_id !== hh.estate_id) {
      return res.status(403).json({ error: 'Cannot approve households outside your estate' });
    }

    const [result] = await db.promise().query(
      `UPDATE households
       SET status = ?, approved_by = ?, approved_at = NOW(), rejection_reason = ?
       WHERE household_id = ? AND status = 'Pending'`,
      [
        status,
        official_id,
        status === 'Rejected' ? rejection_reason || 'No reason provided' : null,
        id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ error: 'Household is not Pending' });
    }

    await invalidateHouseholdCaches(hh.estate_id, id, null);

    // ---- SMS (fire-and-forget) ----
    if (status === 'Approved') {
      (async () => {
        try {
          const [[row]] = await db.promise().query(
            `SELECT primary_owner, contact_number, uid, take_on_balance
             FROM households WHERE household_id = ?`,
            [id]
          );
          const estateName = await fetchEstateName(hh.estate_id);

          if (row?.contact_number) {
            await queueSms(
              row.contact_number,
              sms.householdApproved({
                name: (row.primary_owner || 'Resident').split(' ')[0],
                estateName,
                urn: row.uid,
                takeOnBalance: row.take_on_balance,
              }),
              {
                user_uid: row.uid,
                estate_id: hh.estate_id,
                kind: 'household_approved',
              }
            );
          }
        } catch (e) {
          console.warn('Approval SMS failed:', e.message);
        }
      })();
    }

    // Rejection SMS (optional but included)
    if (status === 'Rejected') {
      (async () => {
        try {
          const [[row]] = await db.promise().query(
            `SELECT primary_owner, contact_number, uid, rejection_reason
             FROM households WHERE household_id = ?`,
            [id]
          );
          const estateName = await fetchEstateName(hh.estate_id);

          if (row?.contact_number) {
            const reason = row.rejection_reason ? ` Reason: ${row.rejection_reason}.` : '';
            await queueSms(
              row.contact_number,
              `Hi ${(row.primary_owner || 'Applicant').split(' ')[0]}, your registration at ${estateName} was not approved.${reason} Contact your estate officials for more info. - Makaazi`,
              {
                user_uid: row.uid,
                estate_id: hh.estate_id,
                kind: 'registration_rejected',
              }
            );
          }
        } catch (e) {
          console.warn('Rejection SMS failed:', e.message);
        }
      })();
    }

    return res.status(200).json({ message: `Household ${status.toLowerCase()} successfully.` });
  } catch (err) {
    console.error('approveHousehold error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// GET /households/searchExisting/:phone?estate_id=
exports.existingHousehold = async (req, res) => {
  const { phone } = req.params;
  const { estate_id } = req.query;

  try {
    let sql = `SELECT household_id FROM households WHERE contact_number = ?`;
    const params = [phone];
    if (estate_id) { sql += ` AND estate_id = ?`; params.push(estate_id); }
    sql += ` LIMIT 1`;

    const [rows] = await db.promise().query(sql, params);
    return res.json({
      exists: rows.length > 0,
      message: rows.length
        ? `Phone ${phone} already registered`
        : `Phone ${phone} is available`,
    });
  } catch (err) {
    console.error('existingHousehold error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /households/update_household/:id
exports.updateHousehold = async (req, res) => {
  const { id } = req.params;
  const fields = req.body;

  if (!id) return res.status(400).json({ error: 'household ID is required' });
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'No fields to update' });

  const blocked = ['household_id', 'uid', 'created_at', 'approved_by', 'approved_at'];
  for (const k of blocked) delete fields[k];

  if (!Object.keys(fields).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const setters = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  const values = [...Object.values(fields), id];

  try {
    const [result] = await db.promise().query(
      `UPDATE households SET ${setters} WHERE household_id = ?`,
      values
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Household not found' });

    const [[h]] = await db.promise().query(
      `SELECT estate_id, uid FROM households WHERE household_id = ?`,
      [id]
    );
    if (h) await invalidateHouseholdCaches(h.estate_id, id, h.uid);

    return res.json({ message: 'Household updated successfully' });
  } catch (err) {
    console.error('updateHousehold error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /households/deleteHousehold/:id
exports.deleteHousehold = async (req, res) => {
  const { id } = req.params;

  try {
    const [[h]] = await db.promise().query(
      `SELECT estate_id, uid FROM households WHERE household_id = ?`,
      [id]
    );
    if (!h) return res.status(404).json({ error: 'Household not found' });

    await db.promise().query(`DELETE FROM households WHERE household_id = ?`, [id]);
    await invalidateHouseholdCaches(h.estate_id, id, h.uid);
    return res.json({ message: 'Household deleted successfully' });
  } catch (err) {
    console.error('deleteHousehold error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
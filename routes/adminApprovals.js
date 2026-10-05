// routes/adminApprovals.js
const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const redisClient = require('../config/redis');
const adminAuth = require('../middleware/adminAuth');
const { requireSuperAdmin } = adminAuth;

/* =============================================================
   Helpers
   ============================================================= */

async function writeAudit(adminEmail, action, entityType, entityId, details) {
  try {
    await db.promise().query(
      `INSERT INTO admin_audit_logs (admin_email, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [
        adminEmail,
        action,
        entityType || null,
        entityId || null,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (e) {
    console.warn('adminApprovals audit failed:', e.message);
  }
}

function parsePayload(p) {
  try {
    return typeof p === 'string' ? JSON.parse(p) : p;
  } catch {
    return {};
  }
}

async function applyApproval(conn, approval, payload) {
  const op = approval.operation;
  const targetId = approval.target_id;

  if (op === 'estate.create') {
    const { address_config, ...estate } = payload;
    const [ins] = await conn.query(
      `INSERT INTO estates
         (estate_name, estate_urn, estate_location,
          latitude, longitude, estate_image, logo_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Active')`,
      [
        estate.estate_name,
        estate.estate_urn,
        estate.estate_location || null,
        estate.latitude  != null ? Number(estate.latitude)  : null,
        estate.longitude != null ? Number(estate.longitude) : null,
        estate.estate_image || null,
        estate.logo_url     || null,
      ]
    );
    const newEstateId = ins.insertId;

    if (address_config) {
      await conn.query(
        `INSERT INTO estate_address_config
           (estate_id, show_street, show_section, show_court, show_house_number)
         VALUES (?, ?, ?, ?, ?)`,
        [
          newEstateId,
          address_config.show_street       ?? 1,
          address_config.show_section      ?? 1,
          address_config.show_court        ?? 1,
          address_config.show_house_number ?? 1,
        ]
      );
    }
    return newEstateId;
  }

  if (op === 'estate.update') {
    const keys = Object.keys(payload || {});
    if (keys.length) {
      const setters = keys.map((k) => `${k} = ?`).join(', ');
      await conn.query(
        `UPDATE estates SET ${setters} WHERE estate_id = ?`,
        [...Object.values(payload), targetId]
      );
    }
    return targetId;
  }

  if (op === 'estate.delete') {
    await conn.query(`DELETE FROM estates WHERE estate_id = ?`, [targetId]);
    return targetId;
  }

  if (op === 'estate.address_config') {
    await conn.query(
      `INSERT INTO estate_address_config
         (estate_id, show_street, show_section, show_court, show_house_number)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         show_street = VALUES(show_street),
         show_section = VALUES(show_section),
         show_court = VALUES(show_court),
         show_house_number = VALUES(show_house_number),
         updated_at = CURRENT_TIMESTAMP`,
      [
        targetId,
        payload.show_street       ? 1 : 0,
        payload.show_section      ? 1 : 0,
        payload.show_court        ? 1 : 0,
        payload.show_house_number ? 1 : 0,
      ]
    );
    return targetId;
  }

  if (op === 'admin.create') {
    const [ins] = await conn.query(
      `INSERT INTO intec_admins (email, full_name, role, active)
       VALUES (?, ?, ?, 1)`,
      [payload.email, payload.full_name || null, payload.role || 'support']
    );
    return ins.insertId;
  }

  if (op === 'admin.update') {
    const keys = Object.keys(payload || {});
    if (keys.length) {
      const setters = keys.map((k) => `${k} = ?`).join(', ');
      await conn.query(
        `UPDATE intec_admins SET ${setters} WHERE id = ?`,
        [...Object.values(payload), targetId]
      );
    }
    return targetId;
  }

  if (op === 'admin.delete') {
    await conn.query(
      `UPDATE intec_admins SET active = 0 WHERE id = ?`,
      [targetId]
    );
    return targetId;
  }

  if (op === 'subscription.upsert') {
    await conn.query(
      `INSERT INTO estate_subscriptions
         (estate_id, plan_id, start_date, end_date, amount_paid,
          payment_status, payment_method, transaction_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         plan_id         = VALUES(plan_id),
         start_date      = VALUES(start_date),
         end_date        = VALUES(end_date),
         amount_paid     = VALUES(amount_paid),
         payment_status  = VALUES(payment_status),
         payment_method  = VALUES(payment_method),
         transaction_id  = VALUES(transaction_id),
         is_active       = VALUES(is_active),
         updated_at      = CURRENT_TIMESTAMP`,
      [
        payload.estate_id,
        payload.plan_id,
        payload.start_date,
        payload.end_date || null,
        Number(payload.amount_paid),
        payload.payment_status || 'Pending',
        payload.payment_method || 'Mpesa',
        payload.transaction_id || `ADMIN-${Date.now()}`,
        payload.is_active ? 1 : 0,
      ]
    );
    return payload.estate_id;
  }

  if (op === 'subscription.status') {
    const s = payload.status;
    if (s === 'Active') {
      await conn.query(
        `UPDATE estate_subscriptions
         SET is_active = 1, payment_status = 'Paid'
         WHERE subscription_id = ?`,
        [targetId]
      );
    } else if (s === 'Cancelled' || s === 'Expired') {
      await conn.query(
        `UPDATE estate_subscriptions SET is_active = 0 WHERE subscription_id = ?`,
        [targetId]
      );
    } else if (s === 'Pending') {
      await conn.query(
        `UPDATE estate_subscriptions
         SET payment_status = 'Pending', is_active = 1
         WHERE subscription_id = ?`,
        [targetId]
      );
    } else if (s === 'Failed') {
      await conn.query(
        `UPDATE estate_subscriptions
         SET payment_status = 'Failed', is_active = 0
         WHERE subscription_id = ?`,
        [targetId]
      );
    }
    return targetId;
  }

  if (op === 'plan.create') {
    const [ins] = await conn.query(
      `INSERT INTO subscription_plans
         (plan_name, min_households, max_households, monthly_rate)
       VALUES (?, ?, ?, ?)`,
      [
        payload.plan_name,
        Number(payload.min_households),
        payload.max_households ?? null,
        Number(payload.monthly_rate),
      ]
    );
    return ins.insertId;
  }

  if (op === 'plan.update') {
    const keys = Object.keys(payload || {});
    if (keys.length) {
      const setters = keys.map((k) => `${k} = ?`).join(', ');
      await conn.query(
        `UPDATE subscription_plans SET ${setters} WHERE plan_id = ?`,
        [...Object.values(payload), targetId]
      );
    }
    return targetId;
  }

  if (op === 'plan.delete') {
    const [[{ count }]] = await conn.query(
      `SELECT COUNT(*) AS count FROM estate_subscriptions WHERE plan_id = ?`,
      [targetId]
    );
    if (count > 0) {
      throw new Error(`Cannot delete — ${count} estate subscription(s) use this plan`);
    }
    await conn.query(`DELETE FROM subscription_plans WHERE plan_id = ?`, [targetId]);
    return targetId;
  }

  if (op === 'official.create') {
    const [[estate]] = await conn.query(
      `SELECT estate_urn FROM estates WHERE estate_id = ? LIMIT 1`,
      [payload.estate_id]
    );

    const [ins] = await conn.query(
      `INSERT INTO officials
         (estate_id, full_name, role, contact_number, estate_urn, uid)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payload.estate_id,
        payload.full_name,
        payload.role || 'Chairman',
        payload.contact_number,
        estate?.estate_urn || null,
        payload.uid || null,
      ]
    );
    return ins.insertId;
  }

  if (op === 'official.update') {
    const keys = Object.keys(payload || {});
    if (keys.length) {
      const setters = keys.map((k) => `${k} = ?`).join(', ');
      await conn.query(
        `UPDATE officials SET ${setters} WHERE official_id = ?`,
        [...Object.values(payload), targetId]
      );
    }
    return targetId;
  }

  if (op === 'official.delete') {
    await conn.query(`DELETE FROM officials WHERE official_id = ?`, [targetId]);
    return targetId;
  }

  if (op === 'charge.add') {
    const [ins] = await conn.query(
      `INSERT INTO service_charges (estate_id, charge_type, frequency, amount)
       VALUES (?, ?, ?, ?)`,
      [
        payload.estate_id,
        payload.charge_type,
        payload.frequency,
        Number(payload.amount),
      ]
    );
    return ins.insertId;
  }

  if (op === 'charge.delete') {
    await conn.query(
      `DELETE FROM service_charges WHERE charges_id = ?`,
      [targetId]
    );
    return targetId;
  }

  throw new Error(`Unknown operation: ${op}`);
}

async function invalidateCacheFor(op, targetId) {
  const jobs = [redisClient.del('estates')];

  if (targetId) {
    jobs.push(redisClient.del(`estate:${targetId}`));
    jobs.push(redisClient.del(`address-config:${targetId}`));
    jobs.push(redisClient.del(`dropdowns:${targetId}`));
    jobs.push(redisClient.del(`service_charges/:${targetId}`));
    jobs.push(redisClient.del(`vehicles:estate:${targetId}`));
  }

  if (op === 'subscription.upsert' || op === 'subscription.status') {
    jobs.push(redisClient.del(`subscription:${targetId}`));
  }

  try {
    await Promise.all(jobs);
  } catch (e) {
    console.warn('cache invalidate failed:', e.message);
  }
}

/* =============================================================
   ROUTES (super-admin only)
   ============================================================= */

router.get('/', adminAuth, requireSuperAdmin, async (req, res) => {
  const status    = req.query.status || 'Pending';
  const operation = req.query.operation;

  const where  = ['status = ?'];
  const params = [status];
  if (operation) {
    where.push('operation = ?');
    params.push(operation);
  }

  try {
    const [rows] = await db.promise().query(
      `SELECT id, operation, target_table, target_id, payload, summary,
              requested_by, requested_email, status,
              reviewed_by, reviewed_email, reviewed_at, rejection_reason,
              created_at, updated_at
       FROM admin_approval_requests
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC`,
      params
    );
    return res.json(rows);
  } catch (err) {
    console.error('listApprovals error:', err.message);
    return res.status(500).json({ error: 'Failed to list approvals' });
  }
});

router.get('/count', adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const [[row]] = await db.promise().query(
      `SELECT COUNT(*) AS pending
       FROM admin_approval_requests
       WHERE status = 'Pending'`
    );
    return res.json({ pending: Number(row.pending || 0) });
  } catch (err) {
    console.error('approvalCount error:', err.message);
    return res.status(500).json({ error: 'Failed to count approvals' });
  }
});

router.get('/:id', adminAuth, requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [[row]] = await db.promise().query(
      `SELECT id, operation, target_table, target_id, payload, summary,
              requested_by, requested_email, status,
              reviewed_by, reviewed_email, reviewed_at, rejection_reason,
              created_at, updated_at
       FROM admin_approval_requests
       WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Request not found' });
    return res.json(row);
  } catch (err) {
    console.error('getApproval error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch request' });
  }
});

router.post('/:id/approve', adminAuth, requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);

  const [[approval]] = await db.promise().query(
    `SELECT * FROM admin_approval_requests WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!approval)                     return res.status(404).json({ error: 'Not found' });
  if (approval.status !== 'Pending') return res.status(409).json({ error: 'Already reviewed' });

  const payload = parsePayload(approval.payload);

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    let finalTargetId = approval.target_id;

    try {
      const resultId = await applyApproval(connection, approval, payload);
      if (resultId != null) finalTargetId = resultId;
    } catch (applyErr) {
      await connection.rollback();
      console.error('applyApproval failed:', applyErr.message);
      return res.status(400).json({ error: applyErr.message });
    }

    await connection.query(
      `UPDATE admin_approval_requests
       SET status = 'Approved',
           target_id = ?,
           reviewed_by = ?,
           reviewed_email = ?,
           reviewed_at = NOW()
       WHERE id = ?`,
      [finalTargetId, req.admin.id, req.admin.email, id]
    );

    await connection.commit();

    await invalidateCacheFor(approval.operation, finalTargetId);

    await writeAudit(
      req.admin.email,
      'approve_request',
      approval.target_table,
      finalTargetId,
      {
        request_id: id,
        operation: approval.operation,
        requested_by: approval.requested_email,
      }
    );

    try {
      const [[requester]] = await db.promise().query(
        `SELECT firebase_uid FROM intec_admins WHERE id = ? LIMIT 1`,
        [approval.requested_by]
      );
      if (requester?.firebase_uid) {
        await db.promise().query(
          `INSERT INTO notifications (user_uid, user_type, title, message, type, is_read)
           VALUES (?, 'ESTATE', 'Request approved', ?, 'SYSTEM', 0)`,
          [requester.firebase_uid, `${approval.summary} was approved.`]
        );
      }
    } catch (e) {
      console.warn('notify requester failed:', e.message);
    }

    return res.json({
      ok: true,
      operation: approval.operation,
      target_id: finalTargetId,
    });
  } catch (err) {
    try { await connection.rollback(); } catch {}
    console.error('approveRequest error:', err.message);
    return res.status(500).json({ error: 'Failed to approve request' });
  } finally {
    connection.release();
  }
});

router.post('/:id/reject', adminAuth, requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body || {};

  const [[approval]] = await db.promise().query(
    `SELECT * FROM admin_approval_requests WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!approval)                     return res.status(404).json({ error: 'Not found' });
  if (approval.status !== 'Pending') return res.status(409).json({ error: 'Already reviewed' });

  try {
    await db.promise().query(
      `UPDATE admin_approval_requests
       SET status = 'Rejected',
           rejection_reason = ?,
           reviewed_by = ?,
           reviewed_email = ?,
           reviewed_at = NOW()
       WHERE id = ?`,
      [reason || null, req.admin.id, req.admin.email, id]
    );

    await writeAudit(
      req.admin.email,
      'reject_request',
      approval.target_table,
      approval.target_id,
      { request_id: id, operation: approval.operation, reason: reason || null }
    );

    try {
      const [[requester]] = await db.promise().query(
        `SELECT firebase_uid FROM intec_admins WHERE id = ? LIMIT 1`,
        [approval.requested_by]
      );
      if (requester?.firebase_uid) {
        await db.promise().query(
          `INSERT INTO notifications (user_uid, user_type, title, message, type, is_read)
           VALUES (?, 'ESTATE', 'Request rejected', ?, 'SYSTEM', 0)`,
          [
            requester.firebase_uid,
            `${approval.summary} was rejected.${reason ? ' Reason: ' + reason : ''}`,
          ]
        );
      }
    } catch (e) {
      console.warn('notify requester failed:', e.message);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('rejectRequest error:', err.message);
    return res.status(500).json({ error: 'Failed to reject request' });
  }
});

module.exports = router;
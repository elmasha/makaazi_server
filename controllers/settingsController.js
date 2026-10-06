// controllers/settingsController.js
const db = require('../config/db');

async function logAdminAction(adminEmail, action, entityType, entityId, details) {
  try {
    await db.promise().query(
      `INSERT INTO admin_audit_logs (admin_email, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [adminEmail, action, entityType || null, entityId || null,
       details ? JSON.stringify(details) : null]
    );
  } catch (e) { console.warn('Audit log failed:', e.message); }
}

// GET /api/admin/settings
exports.getSettings = async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT setting_key, setting_value FROM platform_settings`
    );
    const out = {};
    for (const r of rows) out[r.setting_key] = r.setting_value;
    return res.json(out);
  } catch (err) {
    console.error('getSettings error:', err.message);
    return res.status(500).json({ error: 'Failed to load settings' });
  }
};

// PATCH /api/admin/settings
// Body: { "fees.default_service_fee": "100", "sms.sender_id": "INTEC", ... }
exports.updateSettings = async (req, res) => {
  const updates = req.body || {};
  const keys = Object.keys(updates);
  if (!keys.length) return res.status(400).json({ error: 'No settings provided' });

  // Whitelist — prevents an admin from writing arbitrary keys
  const ALLOWED = new Set([
    'fees.default_service_fee', 'fees.default_security_levy',
    'fees.default_garbage_fee', 'fees.late_penalty_pct',
    'fees.grace_period_days',   'fees.payment_reminder_lead',
    'sms.provider', 'sms.sender_id', 'sms.partner_id', 'sms.api_key',
    'sms.base_url', 'sms.tpl_household_approved', 'sms.tpl_payment_confirmation',
    'email.smtp_host', 'email.smtp_port', 'email.smtp_user', 'email.smtp_pass',
    'email.from_address',
    'platform.name', 'platform.support_phone', 'platform.support_email',
    'security.require_mfa_super', 'security.require_mfa_all',
    'security.ip_allowlist_enabled', 'security.session_idle_minutes',
    'security.max_failed_logins', 'security.ip_allowlist',
  ]);

  const bad = keys.filter((k) => !ALLOWED.has(k));
  if (bad.length) {
    return res.status(400).json({ error: `Unknown setting(s): ${bad.join(', ')}` });
  }

  try {
    const conn = await db.promise().getConnection();
    try {
      await conn.beginTransaction();
      for (const [key, val] of Object.entries(updates)) {
        await conn.query(
          `INSERT INTO platform_settings (setting_key, setting_value, updated_by)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE
             setting_value = VALUES(setting_value),
             updated_by    = VALUES(updated_by)`,
          [key, val == null ? null : String(val), req.admin?.email || null]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    await logAdminAction(req.admin?.email, 'update_settings', 'platform', null, updates);
    return res.json({ message: 'Settings saved' });
  } catch (err) {
    console.error('updateSettings error:', err.message);
    return res.status(500).json({ error: 'Failed to save settings' });
  }
};

// POST /api/admin/settings/test-sms
exports.testSms = async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  try {
    const { sendSms } = require('../services/advantaSms');
    const result = await sendSms(phone, 'Test SMS from Makaazi admin settings.');
    return res.json({ ok: !!result.ok, provider_ref: result.provider_ref || null,
                      error: result.error || null });
  } catch (err) {
    console.error('testSms error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
// controllers/settingsController.js
const db = require('../config/db');

// ============================================================
// Shape definitions — tells the controller how to coerce values
// between the DB (all strings) and the frontend (mixed types)
// ============================================================

// Booleans — DB '1'/'0' ←→ JS true/false
const BOOLEAN_KEYS = new Set([
  'require_mfa_super',
  'require_mfa_all',
  'ip_allowlist_enabled',
]);

// Numbers — stored as strings, returned as numbers
const NUMBER_KEYS = new Set([
  'smtp_port',
  'default_service_fee',
  'default_security_levy',
  'default_garbage_fee',
  'late_penalty_pct',
  'grace_period_days',
  'reminder_lead_days',
  'session_idle_minutes',
  'max_failed_logins',
]);

// Everything else is treated as a string. If a frontend field
// isn't in any of these sets, it's allowed as-is.
const ALLOWED_KEYS = new Set([
  // platform
  'platform_name', 'support_email', 'support_phone', 'currency',
  'timezone', 'date_format',
  // sms
  'sms_provider', 'sms_sender_id', 'sms_partner_id', 'sms_api_key',
  'sms_api_base', 'sms_template_approval', 'sms_template_payment',
  // email
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass',
  'smtp_encryption', 'mail_from_name', 'mail_from_email',
  // fees
  'default_service_fee', 'default_security_levy', 'default_garbage_fee',
  'late_penalty_pct', 'grace_period_days', 'reminder_lead_days',
  // security
  'require_mfa_super', 'require_mfa_all', 'ip_allowlist_enabled',
  'ip_allowlist', 'session_idle_minutes', 'max_failed_logins',
]);

// Never send these to the frontend — they'd allow credential theft
// from a compromised admin session.
const SENSITIVE_KEYS = new Set([
  'sms_api_key',
  'smtp_pass',
]);

// ============================================================
// Helpers
// ============================================================
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

function dbToJs(key, raw) {
  if (raw === null || raw === undefined) {
    return BOOLEAN_KEYS.has(key) ? false : '';
  }
  if (BOOLEAN_KEYS.has(key)) return raw === '1' || raw === 'true';
  if (NUMBER_KEYS.has(key))  return Number(raw) || 0;
  return raw;
}

function jsToDb(key, val) {
  if (val === null || val === undefined) return '';
  if (BOOLEAN_KEYS.has(key)) return val ? '1' : '0';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

// ============================================================
// GET /api/admin/settings
// ============================================================
exports.getSettings = async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT setting_key, setting_value FROM platform_settings`
    );

    const out = {};
    for (const r of rows) {
      if (!ALLOWED_KEYS.has(r.setting_key)) continue;
      out[r.setting_key] = dbToJs(r.setting_key, r.setting_value);
    }

    // Never leak secrets in the response. The frontend has a
    // password field but it starts empty — admin re-enters it
    // only when they want to change it.
    for (const k of SENSITIVE_KEYS) {
      if (out[k]) out[k] = ''; // don't ship the real secret
    }

    return res.json(out);
  } catch (err) {
    console.error('getSettings error:', err.message);
    return res.status(500).json({ error: 'Failed to load settings' });
  }
};

// ============================================================
// PUT /api/admin/settings
// Body: flat object like the frontend form
// ============================================================
exports.updateSettings = async (req, res) => {
  const body = req.body || {};
  const keys = Object.keys(body);

  if (!keys.length) {
    return res.status(400).json({ error: 'No settings provided' });
  }

  const bad = keys.filter((k) => !ALLOWED_KEYS.has(k));
  if (bad.length) {
    return res.status(400).json({
      error: `Unknown setting(s): ${bad.join(', ')}`,
    });
  }

  // Only touch secrets if the frontend actually sent a non-empty value.
  // An empty string here means "leave it alone" — this is why we blank
  // them out in getSettings().
  const updates = {};
  for (const [k, v] of Object.entries(body)) {
    if (SENSITIVE_KEYS.has(k)) {
      if (v === '' || v === null || v === undefined) continue;
      updates[k] = jsToDb(k, v);
      continue;
    }
    updates[k] = jsToDb(k, v);
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

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
        [key, val, req.admin?.email || null]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error('updateSettings error:', e.message);
    return res.status(500).json({ error: 'Failed to save settings' });
  } finally {
    conn.release();
  }

  // Invalidate caches if we touched SMS keys or SMS templates
  const touchedSms = Object.keys(updates).some((k) => k.startsWith('sms_'));
  if (touchedSms) {
    try {
      const { invalidateCache: invalidateAdvanta } = require('../services/advantaSms');
      const { invalidateTemplateCache }            = require('../services/smsTemplates');
      invalidateAdvanta();
      invalidateTemplateCache();
    } catch (e) {
      console.warn('Cache invalidation failed:', e.message);
    }
  }

  // Audit log — redact secrets before logging
  const auditDetails = { ...updates };
  for (const k of SENSITIVE_KEYS) {
    if (auditDetails[k]) auditDetails[k] = '***';
  }
  await logAdminAction(req.admin?.email, 'update_settings', 'platform', null, auditDetails);

  return res.json({ message: 'Settings saved' });
};

// ============================================================
// POST /api/admin/settings/test-sms
// Body: {} (uses configured creds) OR { phone, message }
// ============================================================
exports.testSms = async (req, res) => {
  const { phone, message } = req.body || {};

  // Fall back to admin's own phone if none supplied
  const targetPhone = phone || req.admin?.phone_number;
  if (!targetPhone) {
    return res.status(400).json({
      ok: false,
      error: 'No phone number to send to — add one to your admin profile or pass { phone }',
    });
  }

  const body = message || 'Makaazi test SMS — settings page is correctly wired.';

  try {
    const { sendSms } = require('../services/advantaSms');
    const result = await sendSms(targetPhone, body);

    if (!result.ok) {
      return res.status(200).json({ ok: false, error: result.error });
    }
    return res.json({ ok: true, ref: result.ref || null, to: targetPhone });
  } catch (err) {
    console.error('testSms error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

// ============================================================
// POST /api/admin/settings/test-email
// ============================================================
exports.testEmail = async (req, res) => {
  const to = req.body?.to || req.admin?.email;
  if (!to) return res.status(400).json({ ok: false, error: 'No recipient' });

  // Wire this up once you have a services/mailer.js
  return res.status(501).json({
    ok: false,
    error: 'Email sending not yet implemented — add services/mailer.js',
  });
};

// ============================================================
// POST /api/admin/settings/danger
// Body: { action: 'clear_sms_logs' | 'clear_audit_logs' | 'deactivate_estate_admins' }
// ============================================================
exports.dangerAction = async (req, res) => {
  const { action } = req.body || {};

  const SUPPORTED = new Set([
    'clear_sms_logs',
    'clear_audit_logs',
    'deactivate_estate_admins',
  ]);

  if (!SUPPORTED.has(action)) {
    return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  try {
    if (action === 'clear_sms_logs') {
      await db.promise().query(`DELETE FROM sms_logs`);
    } else if (action === 'clear_audit_logs') {
      // Keep the audit entry we're about to write — truncate first
      await db.promise().query(`DELETE FROM admin_audit_logs`);
    } else if (action === 'deactivate_estate_admins') {
      await db.promise().query(
        `UPDATE intec_admins SET active = 0 WHERE role <> 'super'`
      );
    }

    await logAdminAction(req.admin?.email, `danger_${action}`, 'platform', null, null);
    return res.json({ message: 'Operation completed' });
  } catch (err) {
    console.error('dangerAction error:', err.message);
    return res.status(500).json({ error: 'Operation failed' });
  }
};
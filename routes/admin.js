// routes/admin.js
const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;
const ctrl = require('../controllers/adminController');
const db = require('../config/db');
const { notifySuperAdminsBySms } = require('../services/adminApprovalSms');
const adminApprovalsRouter = require('./adminApprovals');

// ============================================================
// Helpers
// ============================================================
function generateEstateUrn(prefix) {
  const safe = String(prefix || 'EST')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5) || 'EST';
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
  return `${safe}-${ts}-${rand}`;
}

/**
 * Gated middleware.
 * - If the caller is a super admin → next() (real controller runs).
 * - If the caller is support → queue the operation, fire SMS to all
 *   super admins, respond 202.
 *
 * opts.summaryFn   (req, payload) → string
 * opts.payloadFn   (req)         → object  (what gets stored + replayed on approve)
 * opts.targetTable string
 * opts.targetIdFn  (req)         → number|null
 */
function gated(operation, opts = {}) {
  const {
    summaryFn   = (req) => `Operation: ${operation}`,
    payloadFn   = (req) => req.body || {},
    targetTable = 'unknown',
    targetIdFn  = () => null,
  } = opts;

  return async (req, res, next) => {
    if (req.admin?.role === 'super') return next();

    try {
      const payload  = payloadFn(req) || {};
      const summary  = summaryFn(req, payload);
      const targetId = targetIdFn(req);

      const [ins] = await db.promise().query(
        `INSERT INTO admin_approval_requests
           (operation, target_table, target_id, payload, summary,
            requested_by, requested_email, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`,
        [
          operation,
          targetTable,
          targetId,
          JSON.stringify(payload),
          summary,
          req.admin.id,
          req.admin.email,
        ]
      );

      // Fire-and-forget SMS to super admins
      notifySuperAdminsBySms({
        requestId: ins.insertId,
        operation,
        summary,
        requestedEmail: req.admin.email,
      }).catch((e) => console.warn('approval SMS failed:', e.message));

      return res.status(202).json({
        queued: true,
        request_id: ins.insertId,
        message: 'Request queued for super-admin approval',
      });
    } catch (e) {
      console.error('gated queue error:', e.message);
      return res.status(500).json({ error: 'Failed to queue request' });
    }
  };
}

// ============================================================
// PUBLIC (no auth)
// ============================================================
router.post('/login', ctrl.adminLogin);
router.get('/public-stats', ctrl.getPublicStats);

// ============================================================
// APPROVAL QUEUE — mounted BEFORE the global adminAuth so the
// sub-router can apply its own per-route auth without doubling up.
// Final paths: /api/admin/approvals/*
// ============================================================
router.use('/approvals', adminApprovalsRouter);

// ============================================================
// AUTHENTICATED (any admin)
// ============================================================
router.use(adminAuth);

// ------------------------------------------------------------
// Identity
// ------------------------------------------------------------
router.get('/me', ctrl.getMe);

// ------------------------------------------------------------
// Platform stats + activity
// ------------------------------------------------------------
router.get('/stats', ctrl.getPlatformStats);
router.get('/activity', ctrl.getRecentActivity);

// ------------------------------------------------------------
// Estates — CREATE / UPDATE / DELETE are gated
// ------------------------------------------------------------
router.get('/estates', ctrl.listEstates);
router.get('/estates/:id', ctrl.getEstate);

router.post(
  '/estates',
  requireRole('super', 'support'),
  gated('estate.create', {
    payloadFn: (req) => {
      const b = req.body || {};
      const prefix = (b.urn_prefix || (b.estate_name || '').slice(0, 5) || 'EST').toUpperCase();
      const ac = b.address_config || {};
      return {
        estate_name:     b.estate_name,
        estate_urn:      generateEstateUrn(prefix),
        estate_location: b.estate_location || null,
        latitude:        b.latitude  != null ? Number(b.latitude)  : null,
        longitude:       b.longitude != null ? Number(b.longitude) : null,
        estate_image:    b.estate_image || null,
        logo_url:        b.logo_url     || null,
        address_config: {
          show_street:       ac.show_street       ?? 1,
          show_section:      ac.show_section      ?? 1,
          show_court:        ac.show_court        ?? 1,
          show_house_number: ac.show_house_number ?? 1,
        },
      };
    },
    summaryFn: (req, p) => `Create estate "${p.estate_name}" (${p.estate_urn})`,
    targetTable: 'estates',
  }),
  ctrl.createEstate
);

router.patch(
  '/estates/:id',
  requireRole('super', 'support'),
  gated('estate.update', {
    payloadFn: (req) => req.body || {},
    summaryFn: (req) => `Update estate #${req.params.id}`,
    targetTable: 'estates',
    targetIdFn: (req) => Number(req.params.id),
  }),
  ctrl.updateEstate
);

router.delete(
  '/estates/:id',
  requireRole('super', 'support'),
  gated('estate.delete', {
    payloadFn: (req) => ({ estate_id: Number(req.params.id) }),
    summaryFn: (req) => `Delete estate #${req.params.id}`,
    targetTable: 'estates',
    targetIdFn: (req) => Number(req.params.id),
  }),
  ctrl.archiveEstate
);

// ------------------------------------------------------------
// Estate sub-resources
// ------------------------------------------------------------
// Address config — gated (affects all future registrations)
router.post(
  '/estates/:id/address-config',
  requireRole('super', 'support'),
  gated('estate.address_config', {
    payloadFn: (req) => ({
      estate_id: Number(req.params.id),
      show_street:       req.body.show_street  ?? 1,
      show_section:      req.body.show_section ?? 1,
      show_court:        req.body.show_court   ?? 1,
      show_house_number: req.body.show_house_number ?? 1,
    }),
    summaryFn: (req) => `Change address config for estate #${req.params.id}`,
    targetTable: 'estate_address_config',
    targetIdFn: (req) => Number(req.params.id),
  }),
  ctrl.setAddressConfig
);

// Charges — gated (financial impact on residents)
router.post(
  '/estates/:id/charges',
  requireRole('super', 'support'),
  gated('charge.add', {
    payloadFn: (req) => ({
      estate_id:   Number(req.params.id),
      charge_type: req.body.charge_type,
      frequency:   req.body.frequency,
      amount:      Number(req.body.amount),
    }),
    summaryFn: (req) =>
      `Add "${req.body.charge_type}" KES ${req.body.amount} ${req.body.frequency} to estate #${req.params.id}`,
    targetTable: 'service_charges',
    targetIdFn: (req) => Number(req.params.id),
  }),
  ctrl.addCharge
);

router.delete(
  '/charges/:chargeId',
  requireRole('super', 'support'),
  gated('charge.delete', {
    payloadFn: (req) => ({ charges_id: Number(req.params.chargeId) }),
    summaryFn: (req) => `Delete charge #${req.params.chargeId}`,
    targetTable: 'service_charges',
    targetIdFn: (req) => Number(req.params.chargeId),
  }),
  ctrl.deleteCharge
);

// Sections / courts / streets — NOT gated (low impact, reversible)
router.post('/estates/:id/sections', ctrl.addSection);
router.post('/estates/:id/courts',   ctrl.addCourt);
router.post('/estates/:id/streets',  ctrl.addStreet);

// First official — gated (assigns a Chairman)
router.post(
  '/estates/:id/first-official',
  requireRole('super', 'support'),
  gated('official.create', {
    payloadFn: (req) => ({
      estate_id:      Number(req.params.id),
      full_name:      req.body.full_name,
      role:           req.body.role || 'Chairman',
      contact_number: req.body.contact_number,
      uid:            req.body.uid || null,
    }),
    summaryFn: (req) => `Create first official "${req.body.full_name}" for estate #${req.params.id}`,
    targetTable: 'officials',
    targetIdFn: (req) => Number(req.params.id),
  }),
  ctrl.createFirstOfficial
);

// Dropdown deletions — NOT gated
router.delete('/sections/:id', ctrl.deleteSection);
router.delete('/courts/:id',   ctrl.deleteCourt);
router.delete('/streets/:id',  ctrl.deleteStreet);

// ------------------------------------------------------------
// Officials (cross-estate)
// ------------------------------------------------------------
router.get('/officials', ctrl.listOfficials);
router.get('/officials/:id', ctrl.getOfficial);

router.patch(
  '/officials/:id',
  requireRole('super', 'support'),
  gated('official.update', {
    payloadFn: (req) => {
      const b = req.body || {};
      const out = {};
      if (b.full_name      !== undefined) out.full_name      = b.full_name;
      if (b.contact_number !== undefined) out.contact_number = b.contact_number;
      if (b.role           !== undefined) out.role           = b.role;
      if (b.uid            !== undefined) out.uid            = b.uid || null;
      return out;
    },
    summaryFn: (req) => `Update official #${req.params.id}`,
    targetTable: 'officials',
    targetIdFn: (req) => Number(req.params.id),
  }),
  ctrl.updateOfficial
);

router.delete(
  '/officials/:id',
  requireRole('super', 'support'),
  gated('official.delete', {
    payloadFn: (req) => ({ official_id: Number(req.params.id) }),
    summaryFn: (req) => `Delete official #${req.params.id}`,
    targetTable: 'officials',
    targetIdFn: (req) => Number(req.params.id),
  }),
  ctrl.deleteOfficial
);

// ------------------------------------------------------------
// Subscriptions — financial, gated
// ------------------------------------------------------------
router.get('/subscriptions', ctrl.listSubscriptions);

router.post(
  '/subscriptions',
  requireRole('super', 'support'),
  gated('subscription.upsert', {
    payloadFn: (req) => ({
      estate_id:      req.body.estate_id,
      plan_id:        req.body.plan_id,
      start_date:     req.body.start_date,
      end_date:       req.body.end_date || null,
      amount_paid:    Number(req.body.amount_paid),
      payment_status: req.body.payment_status || 'Pending',
      payment_method: req.body.payment_method || 'Mpesa',
      transaction_id: req.body.transaction_id || null,
      is_active:      req.body.is_active ? 1 : 0,
    }),
    summaryFn: (req) => `Subscribe estate #${req.body.estate_id} to plan #${req.body.plan_id}`,
    targetTable: 'estate_subscriptions',
    targetIdFn: (req) => Number(req.body.estate_id),
  }),
  ctrl.upsertSubscription
);

router.post(
  '/subscriptions/:id/status',
  requireRole('super', 'support'),
  gated('subscription.status', {
    payloadFn: (req) => ({ status: req.body.status }),
    summaryFn: (req) => `Set subscription #${req.params.id} to "${req.body.status}"`,
    targetTable: 'estate_subscriptions',
    targetIdFn: (req) => Number(req.params.id),
  }),
  ctrl.setSubscriptionStatus
);

// ------------------------------------------------------------
// Subscription plans (pricing — gated)
// ------------------------------------------------------------
router.get('/subscription-plans', ctrl.listSubscriptionPlans);

router.post(
  '/subscription-plans',
  requireRole('super', 'support'),
  gated('plan.create', {
    payloadFn: (req) => ({
      plan_name:      req.body.plan_name,
      min_households: Number(req.body.min_households),
      max_households: req.body.max_households ?? null,
      monthly_rate:   Number(req.body.monthly_rate),
    }),
    summaryFn: (req) => `Create plan "${req.body.plan_name}"`,
    targetTable: 'subscription_plans',
  }),
  ctrl.createSubscriptionPlan
);

router.patch(
  '/subscription-plans/:id',
  requireRole('super', 'support'),
  gated('plan.update', {
    payloadFn: (req) => req.body || {},
    summaryFn: (req) => `Update plan #${req.params.id}`,
    targetTable: 'subscription_plans',
    targetIdFn: (req) => Number(req.params.id),
  }),
  ctrl.updateSubscriptionPlan
);

router.delete(
  '/subscription-plans/:id',
  requireRole('super', 'support'),
  gated('plan.delete', {
    payloadFn: (req) => ({ plan_id: Number(req.params.id) }),
    summaryFn: (req) => `Delete plan #${req.params.id}`,
    targetTable: 'subscription_plans',
    targetIdFn: (req) => Number(req.params.id),
  }),
  ctrl.deleteSubscriptionPlan
);

// ------------------------------------------------------------
// Residents (read-only cross-estate view)
// ------------------------------------------------------------
router.get('/residents', ctrl.listResidents);

// ------------------------------------------------------------
// Audit logs
// ------------------------------------------------------------
router.get('/audit-logs', ctrl.getAuditLogs);

// ------------------------------------------------------------
// SMS logs + balance
// ------------------------------------------------------------
router.get('/sms-balance',   ctrl.getSmsBalance);
router.get('/sms-stats',     ctrl.getSmsStats);
router.get('/sms-logs',      ctrl.listSmsLogs);
router.get('/sms-logs/:id',  ctrl.getSmsLog);

// ============================================================
// ADMINS — creation/update/delete are gated (privilege escalation)
// Read endpoints stay restricted to super admins only.
// ============================================================
router.get('/admins', requireRole('super'), ctrl.listAdmins);
router.get('/admins/eligible-users', requireRole('super'), ctrl.listEligibleAdminUsers);

router.post(
  '/admins',
  requireRole('super', 'support'),
  gated('admin.create', {
    payloadFn: (req) => ({
      email:     String(req.body.email || '').toLowerCase().trim(),
      full_name: req.body.full_name || null,
      role:      req.body.role || 'support',
    }),
    summaryFn: (req) =>
      `Add ${req.body.role || 'support'} admin "${String(req.body.email || '').toLowerCase().trim()}"`,
    targetTable: 'intec_admins',
  }),
  ctrl.addAdmin
);

router.patch(
  '/admins/:id',
  requireRole('super', 'support'),
  gated('admin.update', {
    payloadFn: (req) => {
      const b = req.body || {};
      const out = {};
      if (b.role         !== undefined) out.role         = b.role;
      if (b.active       !== undefined) out.active       = b.active ? 1 : 0;
      if (b.full_name    !== undefined) out.full_name    = b.full_name;
      if (b.firebase_uid !== undefined) out.firebase_uid = b.firebase_uid || null;
      return out;
    },
    summaryFn: (req) => `Update admin #${req.params.id} (${Object.keys(req.body || {}).join(', ')})`,
    targetTable: 'intec_admins',
    targetIdFn: (req) => Number(req.params.id),
  }),
  ctrl.updateAdmin
);

router.delete(
  '/admins/:id',
  requireRole('super', 'support'),
  gated('admin.delete', {
    payloadFn: (req) => ({ admin_id: Number(req.params.id) }),
    summaryFn: (req) => `Remove admin #${req.params.id}`,
    targetTable: 'intec_admins',
    targetIdFn: (req) => Number(req.params.id),
  }),
  ctrl.removeAdmin
);

// ------------------------------------------------------------
// Vehicles — NOT gated (reversible operational data)
// ------------------------------------------------------------
router.get   ('/vehicles',              ctrl.listAllVehicles);
router.post  ('/vehicles',              ctrl.adminCreateVehicle);
router.get   ('/vehicle-stats',         ctrl.getAdminVehicleStats);
router.get   ('/vehicles/:id',          ctrl.getVehicleById);
router.patch ('/vehicles/:id',          ctrl.adminUpdateVehicle);
router.post  ('/vehicles/:id/approve',  ctrl.adminApproveVehicle);
router.post  ('/vehicles/:id/suspend',  ctrl.adminSuspendVehicle);
router.delete('/vehicles/:id',          ctrl.adminDeleteVehicle);

// ------------------------------------------------------------
// Visitor passes — NOT gated
// ------------------------------------------------------------
router.get   ('/visitor-passes',            ctrl.listAllVisitorPasses);
router.post  ('/visitor-passes/:id/cancel', ctrl.adminCancelVisitorPass);

// ------------------------------------------------------------
// Access logs — NOT gated
// ------------------------------------------------------------
router.get   ('/vehicle-access-logs', ctrl.listAllAccessLogs);

module.exports = router;
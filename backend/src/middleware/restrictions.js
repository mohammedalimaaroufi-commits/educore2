const db = require('../db');
const { getEffectiveRestrictions } = require('../utils/restrictions');

function getCurrentSubscription(teacherId) {
  return db.prepare(`SELECT * FROM subscriptions WHERE teacher_id = ?
    ORDER BY CASE WHEN plan IN ('6_months', 'yearly', 'lifetime') THEN 0 ELSE 1 END,
             CASE WHEN status = 'active' THEN 0 ELSE 1 END,
             datetime(COALESCE(updated_at, created_at)) DESC
    LIMIT 1`).get(teacherId);
}

function requireFeature(feature) {
  return (req, res, next) => {
    const subscription = getCurrentSubscription(req.teacherId);
    const restrictions = getEffectiveRestrictions(req.teacherId, subscription);
    req.featureRestrictions = restrictions;
    if (restrictions.active && restrictions.blocked_features.includes(feature)) {
      return res.status(403).json({
        error: 'هذه الخدمة موقوفة لهذا الحساب حاليًا.',
        code: 'FEATURE_RESTRICTED',
        feature,
        restrictions,
      });
    }
    return next();
  };
}

module.exports = { requireFeature, getCurrentSubscription };

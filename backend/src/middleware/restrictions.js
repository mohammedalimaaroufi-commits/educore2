const db = require('../db');
const { getEffectiveRestrictions } = require('../utils/restrictions');
const { getCurrentSubscription: getSubscriptionForTeacher } = require('../utils/subscriptions');

function getCurrentSubscription(teacherId) {
  return getSubscriptionForTeacher(teacherId);
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

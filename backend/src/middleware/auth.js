const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signToken(teacher) {
  return jwt.sign({ id: teacher.id, email: teacher.email }, SECRET, { expiresIn: EXPIRES_IN });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'غير مصرح - الرجاء تسجيل الدخول' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.teacherId = payload.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'انتهت صلاحية الجلسة، الرجاء تسجيل الدخول مجدداً' });
  }
}

function signAdminToken() {
  return jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '12h' });
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'غير مصرح' });
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.role !== 'admin') return res.status(403).json({ error: 'ممنوع' });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'انتهت صلاحية جلسة المسؤول' });
  }
}

module.exports = { signToken, requireAuth, signAdminToken, requireAdmin };

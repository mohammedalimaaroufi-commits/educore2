// Optional email sending for password-reset links.
// This app is designed to run with zero setup (SQLite, no mail server). If the teacher
// deploys it for real use, filling in the SMTP_* variables in backend/.env turns on
// real email delivery automatically — nothing else to change.
require('dotenv').config();

function emailIsConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendPasswordResetEmail(toEmail, fullName, resetLink) {
  if (!emailIsConfigured()) return false;

  // nodemailer is an optional dependency: only required when SMTP is actually configured,
  // so installs stay lightweight for teachers who never leave the local/dev mode.
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (err) {
    console.error('[mailer] SMTP_* متغيرات موجودة لكن حزمة nodemailer غير مثبتة. شغّل: npm install nodemailer');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: 'إعادة تعيين كلمة المرور — السجل المصاحب الإلكتروني',
    html: `
      <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#2E7D6B;">إعادة تعيين كلمة المرور</h2>
        <p>مرحبًا ${fullName || ''}،</p>
        <p>وصلنا طلب لإعادة تعيين كلمة المرور الخاصة بحسابك. اضغط الزر أدناه لاختيار كلمة مرور جديدة. الرابط صالح لمدة 30 دقيقة فقط.</p>
        <p style="text-align:center; margin: 24px 0;">
          <a href="${resetLink}" style="background:#2E7D6B; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:bold;">إعادة تعيين كلمة المرور</a>
        </p>
        <p style="color:#777; font-size:13px;">إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة بأمان.</p>
      </div>`,
  });
  return true;
}

module.exports = { emailIsConfigured, sendPasswordResetEmail };

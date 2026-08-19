# EduCore Manager — الوثيقة الهندسية والتصميمية

## 1. الهيكلية البرمجية المقترحة (Tech Stack)

هذا المشروع مُسلَّم كنموذج عملي (MVP) قابل للتشغيل فورًا في VSCode، ومصمم بحيث يمكن توسيعه إلى الإنتاج الكامل بأقل قدر من إعادة الهيكلة.

| الطبقة | التقنية في هذا المشروع (MVP) | التوصية للإنتاج الكامل |
|---|---|---|
| **Front-end (Web)** | React 18 + Vite + Tailwind CSS + React Router | نفس المكدس، مع Next.js إن أردت SSR/SEO لصفحة تسويقية |
| **الحالة/البيانات** | React Context + Axios | React Query / TanStack Query للتخزين المؤقت والمزامنة |
| **الرسوم البيانية** | Recharts | Recharts أو D3 للرسوم المتقدمة (Bell Curve مخصص) |
| **Back-end** | Node.js + Express (REST API) | نفس المكدس، أو NestJS للمشاريع الكبيرة (بنية Modules/DI) |
| **قاعدة البيانات** | SQLite (better-sqlite3) — بدون إعداد، ملف واحد | PostgreSQL (عبر Prisma أو Drizzle ORM) — يدعم التزامن والتوسع الأفقي |
| **المصادقة** | JWT + bcrypt (تسجيل بريد/كلمة مرور) | + Google OAuth 2.0 و Sign in with Apple عبر Passport.js أو Auth.js |
| **الدفع/الاشتراكات** | Endpoint مبسّط لمحاكاة الترقية | Stripe Billing (Checkout + Webhooks) لتفعيل/تجديد/إلغاء تلقائي |
| **التخزين السحابي للملفات** | — | S3 / Cloudflare R2 لصور الطلاب والمرفقات الصوتية |
| **Mobile** | (غير مضمن في هذه الحزمة) | React Native + Expo لمشاركة أكبر قدر من منطق الـ API والمكونات مع الويب؛ أو Flutter إذا أردت أداء واجهة أعلى |
| **العمل بدون إنترنت (Offline-First)** | — | IndexedDB (Dexie.js) على الويب، SQLite محلي على الجوال + طابور مزامنة (Sync Queue) يُعالج التعارضات بمنطق "آخر تعديل يفوز" أو دمج يدوي |
| **البنية التحتية** | تشغيل محلي (localhost) | Backend: Docker + Fly.io/Render/AWS ECS. DB: Neon/Supabase/RDS. Frontend: Vercel/Netlify/Cloudflare Pages |
| **المراقبة** | console logs | Sentry (أخطاء) + PostHog/Amplitude (تحليلات استخدام) |

### لماذا SQLite في هذه الحزمة؟
لتجربة المشروع فورًا في VSCode دون تثبيت خادم قاعدة بيانات منفصل. الانتقال إلى PostgreSQL لاحقًا يتطلب فقط تبديل طبقة `backend/src/db` (الاستعلامات SQL قياسية ومتوافقة بنسبة كبيرة).

---

## 2. مخطط تجربة المستخدم (User Flow)

```
[تسجيل حساب معلم]
   ├─ بريد إلكتروني / Google / Apple ID
   ├─ إعداد الملف الشخصي (المادة، المرحلة، اسم المدرسة)
   └─ بدء تلقائي لفترة تجريبية 14 يومًا (كل الميزات مفتوحة، بلا بطاقة ائتمان)
        │
        ▼
[لوحة التحكم الرئيسية Dashboard]
   ├─ تنبيه الفترة التجريبية (يظهر في اليوم 10 / 13 / 14 فقط)
   └─ "+ إنشاء صف جديد"
        │
        ▼
[إنشاء الصف]
   ├─ الاسم، المادة، السنة الدراسية، لون مميز، أيقونة
   └─ يُنشأ تلقائيًا: فئات درجات افتراضية (مشاركة/واجبات/اختبارات/مشروع/نهائي)
       وسلوكيات افتراضية (مشاركة متميزة، تأخر، إزعاج...) لبدء سريع بلا إعداد يدوي
        │
        ▼
[تبويب "الطلاب"]
   ├─ استيراد دفعة عبر CSV/Excel (قالب جاهز للتنزيل) — أو
   └─ إضافة يدوية (الاسم، رقم القيد، بيانات ولي الأمر، ملاحظات صحية)
        │
        ▼
[الاستخدام اليومي المتكرر]
   ├─ تبويب "الحضور": تحديد الحالة لكل طالب بضغطة واحدة، لكل تاريخ
   ├─ تبويب "السلوك": رصد سلوك بنقرة واحدة لكل طالب + ملاحظة اختيارية
   └─ تبويب "دفتر الدرجات": Quick-Grid لإدخال درجات تقييم كامل لكل الطلاب في شاشة واحدة
        │
        ▼
[تبويب "التحليلات"]
   ├─ توزيع درجات الفصل (Bar/Bell Curve)
   └─ منحنى النمو الأكاديمي لطالب محدد عبر الزمن
        │
        ▼
[تبويب "التقارير"]
   ├─ تقرير شامل للفصل (درجة نهائية + سلوك + حضور لكل طالب)
   ├─ تصدير Excel/CSV فوري
   └─ تصدير PDF (عبر الطباعة → حفظ كـ PDF؛ يمكن استبداله بمحرك PDF مثل Puppeteer في الإنتاج)
        │
        ▼
[عند اقتراب/انتهاء الفترة التجريبية]
   └─ صفحة "ترقية الاشتراك" → اختيار باقة (6 أشهر / سنوية / مدى الحياة) → بوابة دفع
```

---

## 3. نموذج البيانات (Database Schema / ERD)

```
teachers (المعلم)
  id (PK)
  full_name, email (unique), password_hash, auth_provider
  subject, school_stage, school_name, locale
        │ 1
        │
        │ N
subscriptions (الاشتراك)
  id (PK), teacher_id (FK → teachers)
  plan: trial | 6_months | yearly | lifetime
  status, trial_start_date, trial_end_date
  current_period_start, current_period_end
  payment_provider, payment_reference

teachers 1 ──── N classes (الصفوف)
  id (PK), teacher_id (FK)
  name, subject, academic_year, color, icon, archived

classes 1 ──── N students (الطلاب)
  id (PK), class_id (FK)
  full_name, student_number, photo_url
  guardian_name, guardian_phone, guardian_email
  health_notes, private_notes, archived

classes 1 ──── N grade_categories (فئات التقييم)
  id (PK), class_id (FK)
  name, weight_percent, grading_type: numeric|letter|rubric, sort_order

grade_categories 1 ──── N assessments (تقييم محدد، مثل "اختبار 1")
  id (PK), category_id (FK)
  title, max_score, date

assessments 1 ──── N grades (درجة كل طالب في تقييم)
  id (PK), assessment_id (FK), student_id (FK → students)
  score_numeric, score_letter, rubric_json, comment
  UNIQUE(assessment_id, student_id)

classes 1 ──── N behavior_types (أنواع السلوك، افتراضية + مخصصة)
  id (PK), class_id (FK)
  label, polarity: positive|negative, points, icon, is_default

students 1 ──── N behavior_logs (سجل السلوك)
  id (PK), student_id (FK), behavior_type_id (FK)
  note_text, note_audio_url, occurred_at

classes 1 ──── N attendance_sessions (جلسة حضور ليوم دراسي واحد)
  id (PK), class_id (FK), session_date
  UNIQUE(class_id, session_date)

attendance_sessions 1 ──── N attendance_records (حالة كل طالب في تلك الجلسة)
  id (PK), session_id (FK), student_id (FK)
  status: present|absent|late|excused
  UNIQUE(session_id, student_id)
```

**ملاحظات تصميمية مهمة:**
- **تحويل الطالب بين الصفوف**: عند النقل، يبقى `student_id` كما هو ويتغير `class_id` فقط — لذا يبقى كامل سجل الدرجات والسلوك والحضور مرتبطًا بالطالب تلقائيًا دون فقدان بيانات.
- **الدرجة النهائية الموزونة** تُحسب ديناميكيًا (وليست مخزنة) من: `(مجموع الدرجات المُحصّلة / الدرجات الممكنة في كل فئة) × وزن الفئة`، مما يضمن دقة الأرقام دائمًا حتى بعد أي تعديل لاحق.
- **الحذف = أرشفة** في كل الكيانات الحساسة (طالب، صف) بدلاً من الحذف النهائي، لحماية السجل الأكاديمي والسلوكي التاريخي.

---

## 4. التميز عن TeacherKit — كيف يظهر في هذه الحزمة

| الميزة | تنفيذها في هذا المشروع |
|---|---|
| دعم عربي كامل RTL | `dir="rtl"` افتراضيًا + خطوط عربية (Cairo/Tajawal) + كل الواجهات والنصوص بالعربية |
| تقليل النقرات | رصد السلوك والحضور بضغطة واحدة، Quick-Grid لإدخال درجة الصف كامل في شاشة واحدة |
| منشئ تقارير ذكي | تقرير طالب/صف موحّد يُبنى تلقائيًا من الدرجات + السلوك + الحضور دون إدخال يدوي |
| Offline-First | غير مُفعّل في هذا الـ MVP (يتطلب Service Worker/IndexedDB)، لكن البنية (REST + معرّفات UUID تُنشأ في الطرفين) جاهزة له — راجع جدول التقنيات أعلاه |

---

## 5. خطوات موصى بها للانتقال إلى الإنتاج
1. استبدال SQLite بـ PostgreSQL عبر Prisma (schema شبه مطابق لما ورد أعلاه).
2. دمج Stripe Billing الفعلي بدلاً من `PATCH /api/auth/subscription` التجريبي.
3. إضافة Google/Apple OAuth عبر Auth.js.
4. تفعيل رفع الصور (صورة الطالب، الشعار) عبر S3/R2 مع توقيع روابط مؤقتة.
5. توليد PDF فعلي عبر Puppeteer بدل الاعتماد على طباعة المتصفح.
6. بناء تطبيق React Native يستهلك نفس REST API لتوفير نسخة الجوال.

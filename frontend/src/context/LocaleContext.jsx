import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext.jsx';
import { savePendingProfile } from '../utils/localCache.js';

const DICTIONARY = {
  ar: {
    appLoading: 'جارِ التحميل...',
    offline: 'لا يوجد اتصال بالخادم حاليًا. تظهر النسخ المحفوظة على هذا الجهاز، وستتم محاولة المزامنة عند عودة الاتصال.',
    profile: 'الملف الشخصي',
    language: 'لغة النظام',
    arabic: 'العربية',
    english: 'English',
    save: 'حفظ',
    saved: 'تم الحفظ',
    fullName: 'الاسم الكامل',
    subject: 'المادة',
    schoolStage: 'المرحلة الدراسية',
    schoolName: 'اسم المدرسة',
    subscription: 'إدارة الاشتراك',
    settings: 'الإعدادات',
    dashboard: 'لوحة التحكم',
    students: 'الطلاب',
    gradebook: 'دفتر الدرجات',
    behavior: 'السلوك',
    attendance: 'الحضور',
    analytics: 'التحليلات',
    reports: 'التقارير',
    myClasses: 'صفوفي الدراسية',
    archivedClasses: 'الصفوف المؤرشفة',
    newClass: 'إنشاء صف جديد',
    logout: 'تسجيل الخروج',
    registerTitle: 'إنشاء حساب معلم',
    registerSubtitle: 'ابدأ بتنظيم صفوفك من اليوم مع تجربة مجانية كاملة.',
    registerStep: 'بيانات الحساب',
    registerSchool: 'بيانات المدرسة',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    confirmPassword: 'تأكيد كلمة المرور',
    school: 'المدرسة / المؤسسة',
    languageChoice: 'لغة الواجهة',
    startTrial: 'ابدأ التجربة المجانية',
    haveAccount: 'لديك حساب بالفعل؟',
    login: 'تسجيل الدخول',
    requiredFields: 'يرجى إكمال الحقول المطلوبة',
    passwordMismatch: 'كلمتا المرور غير متطابقتين',
    pdfGradebook: 'تنزيل PDF رسمي A4',
    csvExport: 'تنزيل CSV',
    guideWelcome: 'مرحبًا بك في EduCore Manager',
    guideWelcomeText: 'سنأخذك في جولة قصيرة للتعرف على أهم أدوات إدارة الفصل.',
    guideNext: 'التالي',
    guideBack: 'السابق',
    guideSkip: 'تخطي الجولة',
    guideFinish: 'إنهاء الجولة',
    guideDashboard: 'من هنا تدير صفوفك وتفتح أي صف بسرعة.',
    guideStudents: 'أضف الطلاب واربط صورهم وبياناتهم الأساسية.',
    guideGrades: 'سجّل الدرجات حسب الفئات والتقييمات الفرعية ثم صدّر سجلًا رسميًا.',
    guideBehavior: 'سجّل السلوك بنقرة واحدة وفرز الطلاب حسب النقاط والملاحظات.',
    guideAnalytics: 'اقرأ الرسوم والتحليلات بأسماء الفئات والأوزان والمتوسطات.',
    guideSubscription: 'تابع التجربة والعروض والباقات من صفحة الاشتراك.',
  },
  en: {
    appLoading: 'Loading...',
    offline: 'The server is currently unavailable. Saved data on this device remains available and will sync when the connection returns.',
    profile: 'Profile',
    language: 'System language',
    arabic: 'العربية',
    english: 'English',
    save: 'Save',
    saved: 'Saved',
    fullName: 'Full name',
    subject: 'Subject',
    schoolStage: 'School stage',
    schoolName: 'School name',
    subscription: 'Subscription',
    settings: 'Settings',
    dashboard: 'Dashboard',
    students: 'Students',
    gradebook: 'Gradebook',
    behavior: 'Behavior',
    attendance: 'Attendance',
    analytics: 'Analytics',
    reports: 'Reports',
    myClasses: 'My classes',
    archivedClasses: 'Archived classes',
    newClass: 'Create new class',
    logout: 'Log out',
    registerTitle: 'Create teacher account',
    registerSubtitle: 'Start organizing your classes today with a full free trial.',
    registerStep: 'Account details',
    registerSchool: 'School details',
    email: 'Email address',
    password: 'Password',
    confirmPassword: 'Confirm password',
    school: 'School / institution',
    languageChoice: 'Interface language',
    startTrial: 'Start free trial',
    haveAccount: 'Already have an account?',
    login: 'Log in',
    requiredFields: 'Please complete the required fields',
    passwordMismatch: 'Passwords do not match',
    pdfGradebook: 'Download formal A4 PDF',
    csvExport: 'Download CSV',
    guideWelcome: 'Welcome to EduCore Manager',
    guideWelcomeText: 'Take a quick tour of the essential classroom management tools.',
    guideNext: 'Next',
    guideBack: 'Back',
    guideSkip: 'Skip tour',
    guideFinish: 'Finish tour',
    guideDashboard: 'Manage your classes and open any class quickly from here.',
    guideStudents: 'Add students and maintain their basic information and photos.',
    guideGrades: 'Record grades by categories and sub-assessments, then export a formal record.',
    guideBehavior: 'Record behavior with one click and sort students by points and notes.',
    guideAnalytics: 'Read charts with category names, weights, and averages.',
    guideSubscription: 'Track your trial, offers, and plans from the subscription page.',
  },
};

const LocaleContext = createContext(null);

function readInitialLocale() {
  try {
    const saved = localStorage.getItem('educore_locale');
    return saved === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

export function LocaleProvider({ children }) {
  const { teacher, updateLocalTeacher } = useAuth();
  const [locale, setLocaleState] = useState(readInitialLocale);

  useEffect(() => {
    if (teacher?.locale === 'ar' || teacher?.locale === 'en') setLocaleState(teacher.locale);
  }, [teacher?.locale]);

  useEffect(() => {
    localStorage.setItem('educore_locale', locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.body.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  const changeLocale = async (nextLocale) => {
    const next = nextLocale === 'en' ? 'en' : 'ar';
    setLocaleState(next);
    if (!teacher?.id) return;
    const nextTeacher = { ...teacher, locale: next };
    updateLocalTeacher(nextTeacher);
    try {
      await api.patch('/settings/profile', { locale: next });
    } catch {
      savePendingProfile(teacher.id, { locale: next });
    }
  };

  const value = useMemo(() => ({
    locale,
    isArabic: locale === 'ar',
    direction: locale === 'ar' ? 'rtl' : 'ltr',
    t: (key, fallback) => DICTIONARY[locale]?.[key] || fallback || key,
    changeLocale,
  }), [locale, teacher?.id]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

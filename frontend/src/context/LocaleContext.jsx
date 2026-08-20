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

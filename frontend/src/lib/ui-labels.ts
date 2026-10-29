import type { Language } from './language';

// Short interface labels that Google Translate consistently gets wrong:
// "Saved" came back as "أنقذ" (rescue), "Home" as "بيت" (house), "Shops" as a
// long retail phrase. Every string here is rendered by a component that marks
// its text `notranslate`, so the widget leaves the curated wording alone, while
// long copy (captions, product names, legal pages) still comes from the widget.
//
// Keys are the exact English source strings, which keeps this list honest: if a
// component stops rendering that string, the entry silently stops being used.
export const ARABIC_UI_LABELS: Record<string, string> = {
  // Header navigation and actions.
  Home: 'الرئيسية',
  Trending: 'الأكثر رواجاً',
  Videos: 'الفيديوهات',
  Saved: 'المحفوظات',
  Shops: 'المتاجر',
  Stores: 'المتاجر',
  Pricing: 'الأسعار',
  Create: 'إنشاء',
  'Search posts and stores': 'ابحث في المنشورات والمتاجر',

  // Feed toolbar.
  'For you': 'لك',
  Explore: 'استكشف',
  Latest: 'الأحدث',
  'All types': 'كل الأنواع',
  'Clear all': 'مسح الكل',
  'Sort by': 'ترتيب حسب',
  'Newest first': 'الأحدث أولاً',
  'Find a shop type…': 'ابحث عن نوع متجر…',

  // Footer.
  'Plans & pricing': 'الخطط والأسعار',
  'Terms & Conditions': 'الشروط والأحكام',
  'Privacy Policy': 'سياسة الخصوصية',
  'Get in touch': 'تواصل معنا',
  'Preview the design': 'معاينة التصميم',
  'Back to live feed': 'العودة إلى البث المباشر',

  // Owner and admin panel sections.
  Overview: 'نظرة عامة',
  Users: 'المستخدمون',
  Content: 'المحتوى',
  Boost: 'الترويج',
  Subscriptions: 'الاشتراكات',
  Plans: 'الخطط',
  Verification: 'التحقق',
  'My shops': 'متاجري',
  'My stores': 'متاجري',
  'Products / menu': 'المنتجات / القائمة',
  Posts: 'المنشورات',
  'Store editor': 'محرر المتجر',
  'Shop design': 'تصميم المتجر',
  'Shop settings': 'إعدادات المتجر',
  'My plan': 'خطتي',
  Team: 'الفريق',
};

export function uiLabel(language: Language, english: string): string {
  if (language !== 'ar') return english;
  return ARABIC_UI_LABELS[english] ?? english;
}

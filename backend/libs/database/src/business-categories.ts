// One code-owned taxonomy shared by shop creation, storefront badges, feed
// facets and ranking. Slugs are stable API values; labels are display text.
export interface BusinessCategoryGroup {
  slug: string;
  label: string;
}

export interface BusinessCategoryDefinition {
  slug: string;
  label: string;
  group: BusinessCategoryGroup['slug'];
}

export const BUSINESS_CATEGORY_GROUPS: readonly BusinessCategoryGroup[] = [
  { slug: 'food_drink', label: 'Food & drink' },
  { slug: 'retail_fashion', label: 'Retail & fashion' },
  { slug: 'education', label: 'Education' },
  { slug: 'digital_media', label: 'Digital & media' },
  { slug: 'health_wellness', label: 'Health & wellness' },
  { slug: 'beauty_care', label: 'Beauty & personal care' },
  { slug: 'home_services', label: 'Home & maintenance' },
  { slug: 'professional', label: 'Professional services' },
  { slug: 'travel_events', label: 'Travel & events' },
  { slug: 'automotive', label: 'Automotive' },
  { slug: 'arts_culture', label: 'Arts & culture' },
  { slug: 'community', label: 'Community & public' },
  { slug: 'industry', label: 'Industry & agriculture' },
  { slug: 'other', label: 'Other' },
];

// A deliberately broad list: most local businesses should find an honest fit
// instead of falling into "Other". Owners can change it later from the panel.
export const BUSINESS_CATEGORIES: readonly BusinessCategoryDefinition[] = [
  // Food & drink
  { slug: 'restaurants', label: 'Restaurant', group: 'food_drink' },
  { slug: 'cafe', label: 'Café / coffee shop', group: 'food_drink' },
  { slug: 'bakery', label: 'Bakery', group: 'food_drink' },
  { slug: 'pastry_shop', label: 'Pastry & desserts', group: 'food_drink' },
  { slug: 'fast_food', label: 'Fast food', group: 'food_drink' },
  { slug: 'food_truck', label: 'Food truck', group: 'food_drink' },
  { slug: 'juice_bar', label: 'Juice & smoothies', group: 'food_drink' },
  { slug: 'ice_cream_shop', label: 'Ice cream shop', group: 'food_drink' },
  { slug: 'catering', label: 'Catering', group: 'food_drink' },
  { slug: 'bar_pub', label: 'Bar & pub', group: 'food_drink' },
  { slug: 'shisha_lounge', label: 'Shisha lounge', group: 'food_drink' },
  { slug: 'chocolatier', label: 'Chocolatier', group: 'food_drink' },

  // Retail & fashion
  { slug: 'clothing_store', label: 'Clothing store', group: 'retail_fashion' },
  { slug: 'shoe_store', label: 'Shoe store', group: 'retail_fashion' },
  { slug: 'accessories_store', label: 'Accessories', group: 'retail_fashion' },
  { slug: 'jewelry_store', label: 'Jewelry', group: 'retail_fashion' },
  { slug: 'bag_store', label: 'Bags & leather goods', group: 'retail_fashion' },
  {
    slug: 'fabric_tailor',
    label: 'Fabric & tailoring',
    group: 'retail_fashion',
  },
  { slug: 'modest_fashion', label: 'Modest fashion', group: 'retail_fashion' },
  { slug: 'perfume_store', label: 'Perfume', group: 'retail_fashion' },
  { slug: 'watch_store', label: 'Watches', group: 'retail_fashion' },
  { slug: 'optical_store', label: 'Optical store', group: 'retail_fashion' },
  {
    slug: 'beauty_supplies',
    label: 'Beauty supplies',
    group: 'retail_fashion',
  },
  { slug: 'supermarket', label: 'Supermarket', group: 'retail_fashion' },
  { slug: 'grocery_store', label: 'Grocery store', group: 'retail_fashion' },
  {
    slug: 'convenience_store',
    label: 'Convenience store',
    group: 'retail_fashion',
  },
  {
    slug: 'retail_store',
    label: 'General retail shop',
    group: 'retail_fashion',
  },
  { slug: 'home_furniture', label: 'Furniture', group: 'retail_fashion' },
  { slug: 'home_decor', label: 'Home décor', group: 'retail_fashion' },
  {
    slug: 'appliances_store',
    label: 'Home appliances',
    group: 'retail_fashion',
  },
  { slug: 'electronics_store', label: 'Electronics', group: 'retail_fashion' },
  { slug: 'mobile_store', label: 'Mobile phones', group: 'retail_fashion' },
  { slug: 'computer_store', label: 'Computers', group: 'retail_fashion' },
  { slug: 'hardware_store', label: 'Hardware', group: 'retail_fashion' },
  {
    slug: 'building_materials',
    label: 'Building materials',
    group: 'retail_fashion',
  },
  {
    slug: 'stationery_store',
    label: 'Books & stationery',
    group: 'retail_fashion',
  },
  { slug: 'toy_store', label: 'Toys', group: 'retail_fashion' },
  { slug: 'gift_shop', label: 'Gifts', group: 'retail_fashion' },
  { slug: 'flower_shop', label: 'Flowers', group: 'retail_fashion' },
  { slug: 'pet_store', label: 'Pet supplies', group: 'retail_fashion' },
  { slug: 'sports_retail', label: 'Sports equipment', group: 'retail_fashion' },
  { slug: 'auto_parts', label: 'Car parts', group: 'retail_fashion' },
  { slug: 'motorcycle_store', label: 'Motorcycles', group: 'retail_fashion' },
  { slug: 'pharmacy', label: 'Pharmacy', group: 'retail_fashion' },

  // Education
  { slug: 'school', label: 'School', group: 'education' },
  { slug: 'university', label: 'University', group: 'education' },
  { slug: 'kindergarten', label: 'Kindergarten / nursery', group: 'education' },
  { slug: 'tutoring_center', label: 'Tutoring center', group: 'education' },
  { slug: 'language_center', label: 'Language center', group: 'education' },
  {
    slug: 'training_institute',
    label: 'Training institute',
    group: 'education',
  },
  { slug: 'music_school', label: 'Music & arts school', group: 'education' },
  { slug: 'driving_school', label: 'Driving school', group: 'education' },
  { slug: 'online_courses', label: 'Online courses', group: 'education' },

  // Digital & media
  {
    slug: 'social_media_services',
    label: 'Social media services',
    group: 'digital_media',
  },
  {
    slug: 'marketing_agency',
    label: 'Marketing agency',
    group: 'digital_media',
  },
  { slug: 'design_studio', label: 'Design studio', group: 'digital_media' },
  { slug: 'web_development', label: 'Web development', group: 'digital_media' },
  {
    slug: 'software_company',
    label: 'Software company',
    group: 'digital_media',
  },
  { slug: 'photography', label: 'Photography', group: 'digital_media' },
  { slug: 'videography', label: 'Videography', group: 'digital_media' },
  { slug: 'content_creator', label: 'Content creator', group: 'digital_media' },
  { slug: 'printing_shop', label: 'Printing', group: 'digital_media' },
  { slug: 'advertising_agency', label: 'Advertising', group: 'digital_media' },
  { slug: 'podcast_studio', label: 'Podcast studio', group: 'digital_media' },
  { slug: 'gaming_esports', label: 'Gaming & esports', group: 'digital_media' },
  { slug: 'it_services', label: 'IT services', group: 'digital_media' },

  // Health & wellness
  { slug: 'clinic', label: 'Clinic', group: 'health_wellness' },
  { slug: 'dental_clinic', label: 'Dental clinic', group: 'health_wellness' },
  { slug: 'hospital', label: 'Hospital', group: 'health_wellness' },
  { slug: 'medical_lab', label: 'Medical lab', group: 'health_wellness' },
  { slug: 'physiotherapy', label: 'Physiotherapy', group: 'health_wellness' },
  { slug: 'nutritionist', label: 'Nutritionist', group: 'health_wellness' },
  { slug: 'gym_fitness', label: 'Gym & fitness', group: 'health_wellness' },
  { slug: 'yoga_pilates', label: 'Yoga & Pilates', group: 'health_wellness' },
  { slug: 'spa', label: 'Spa', group: 'health_wellness' },
  {
    slug: 'wellness_center',
    label: 'Wellness center',
    group: 'health_wellness',
  },
  {
    slug: 'medical_supplies',
    label: 'Medical supplies',
    group: 'health_wellness',
  },

  // Beauty & personal care
  { slug: 'beauty_salon', label: 'Beauty salon', group: 'beauty_care' },
  { slug: 'barbershop', label: 'Barbershop', group: 'beauty_care' },
  { slug: 'nail_studio', label: 'Nail studio', group: 'beauty_care' },
  { slug: 'skincare_clinic', label: 'Skincare clinic', group: 'beauty_care' },
  { slug: 'makeup_artist', label: 'Makeup artist', group: 'beauty_care' },
  { slug: 'laser_center', label: 'Laser & aesthetics', group: 'beauty_care' },

  // Home & maintenance
  {
    slug: 'architecture_office',
    label: 'Architecture office',
    group: 'home_services',
  },
  { slug: 'interior_design', label: 'Interior design', group: 'home_services' },
  {
    slug: 'construction_company',
    label: 'Construction',
    group: 'home_services',
  },
  { slug: 'contracting', label: 'Contracting', group: 'home_services' },
  {
    slug: 'cleaning_services',
    label: 'Cleaning services',
    group: 'home_services',
  },
  { slug: 'plumbing', label: 'Plumbing', group: 'home_services' },
  {
    slug: 'electrical_services',
    label: 'Electrical services',
    group: 'home_services',
  },
  {
    slug: 'maintenance_services',
    label: 'Maintenance',
    group: 'home_services',
  },
  { slug: 'moving_services', label: 'Moving services', group: 'home_services' },
  {
    slug: 'security_services',
    label: 'Security services',
    group: 'home_services',
  },
  { slug: 'laundry', label: 'Laundry & dry cleaning', group: 'home_services' },
  { slug: 'pest_control', label: 'Pest control', group: 'home_services' },

  // Professional services
  { slug: 'law_office', label: 'Law office', group: 'professional' },
  {
    slug: 'accounting_firm',
    label: 'Accounting & audit',
    group: 'professional',
  },
  { slug: 'consulting_firm', label: 'Consulting', group: 'professional' },
  { slug: 'insurance_agency', label: 'Insurance', group: 'professional' },
  { slug: 'real_estate', label: 'Real estate', group: 'professional' },
  {
    slug: 'property_management',
    label: 'Property management',
    group: 'professional',
  },
  {
    slug: 'financial_services',
    label: 'Financial services',
    group: 'professional',
  },
  { slug: 'hr_recruitment', label: 'HR & recruitment', group: 'professional' },
  {
    slug: 'translation_services',
    label: 'Translation services',
    group: 'professional',
  },

  // Travel & events
  { slug: 'hotel', label: 'Hotel', group: 'travel_events' },
  { slug: 'guesthouse', label: 'Guesthouse', group: 'travel_events' },
  { slug: 'travel_agency', label: 'Travel agency', group: 'travel_events' },
  { slug: 'tour_operator', label: 'Tour operator', group: 'travel_events' },
  { slug: 'car_rental', label: 'Car rental', group: 'travel_events' },
  { slug: 'event_venue', label: 'Event venue', group: 'travel_events' },
  {
    slug: 'wedding_planner',
    label: 'Wedding planning',
    group: 'travel_events',
  },
  {
    slug: 'events_company',
    label: 'Events & entertainment',
    group: 'travel_events',
  },

  // Automotive
  { slug: 'car_dealership', label: 'Car dealership', group: 'automotive' },
  { slug: 'car_repair', label: 'Car repair', group: 'automotive' },
  { slug: 'car_wash', label: 'Car wash', group: 'automotive' },
  { slug: 'tire_shop', label: 'Tire shop', group: 'automotive' },

  // Arts & culture
  { slug: 'art_gallery', label: 'Art gallery', group: 'arts_culture' },
  { slug: 'music_band', label: 'Music & bands', group: 'arts_culture' },
  { slug: 'theater_cinema', label: 'Theater & cinema', group: 'arts_culture' },
  {
    slug: 'entertainment_venue',
    label: 'Entertainment venue',
    group: 'arts_culture',
  },
  { slug: 'museum', label: 'Museum', group: 'arts_culture' },
  {
    slug: 'handmade_crafts',
    label: 'Handmade & crafts',
    group: 'arts_culture',
  },

  // Community & public
  { slug: 'ngo', label: 'NGO / nonprofit', group: 'community' },
  { slug: 'charity', label: 'Charity', group: 'community' },
  { slug: 'mosque', label: 'Mosque', group: 'community' },
  { slug: 'church', label: 'Church', group: 'community' },
  { slug: 'government_office', label: 'Government office', group: 'community' },
  { slug: 'municipality', label: 'Municipality', group: 'community' },
  { slug: 'library', label: 'Library', group: 'community' },
  { slug: 'community_center', label: 'Community center', group: 'community' },

  // Industry & agriculture
  { slug: 'farm', label: 'Farm', group: 'industry' },
  { slug: 'plant_nursery', label: 'Plants & nursery', group: 'industry' },
  { slug: 'factory', label: 'Factory', group: 'industry' },
  { slug: 'wholesale', label: 'Wholesale', group: 'industry' },
  {
    slug: 'logistics_shipping',
    label: 'Logistics & shipping',
    group: 'industry',
  },
  { slug: 'recycling', label: 'Recycling', group: 'industry' },

  // Other
  { slug: 'other', label: 'Other business', group: 'other' },
];

export const DEFAULT_BUSINESS_CATEGORY = 'other';

const GROUP_BY_SLUG = new Map(
  BUSINESS_CATEGORY_GROUPS.map((group) => [group.slug, group]),
);

const CATEGORY_BY_SLUG = new Map(
  BUSINESS_CATEGORIES.map((category) => [category.slug, category]),
);

export function isBusinessCategory(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    CATEGORY_BY_SLUG.has(value.trim())
  );
}

export function businessCategoryDefinition(
  value: string | null | undefined,
): BusinessCategoryDefinition {
  const slug = value?.trim() ?? '';
  return (
    CATEGORY_BY_SLUG.get(slug) ??
    CATEGORY_BY_SLUG.get(DEFAULT_BUSINESS_CATEGORY)!
  );
}

export function businessCategoryLabel(
  value: string | null | undefined,
): string {
  return businessCategoryDefinition(value).label;
}

export function businessCategoryGroupLabel(
  value: string | null | undefined,
): string {
  const group = GROUP_BY_SLUG.get(businessCategoryDefinition(value).group);
  return group?.label ?? GROUP_BY_SLUG.get('other')!.label;
}

// Existing rows predate the taxonomy. Restaurant-style shops map to the
// closest food category; everything else stays visible as a general shop.
export function defaultBusinessCategoryForStoreType(
  storeType: string | null | undefined,
): string {
  return storeType === 'restaurant_menu' ? 'restaurants' : 'retail_store';
}

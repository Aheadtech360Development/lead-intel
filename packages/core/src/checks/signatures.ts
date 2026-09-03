/**
 * The third-party fingerprints the §5.5 and §5.6 checks match against.
 *
 * Kept in one file, as data, for the same reason the crawl rules are: these are the parts of the
 * system that will drift as the web does, and having them in one reviewable table means updating
 * them is a small deliberate edit rather than an archaeology exercise across a dozen checks.
 *
 * Every pattern here matches against the page's raw HTML (lowercased). Script *contents* count,
 * not just script `src` attributes — a Meta Pixel is usually an inline `fbq('init', ...)` block
 * with no external src at all, and matching only on src would miss most real installations.
 */

export interface Signature {
  /** How it appears to an operator: "Google Analytics 4", not "gtag-g". */
  name: string;
  patterns: RegExp[];
}

function matches(haystack: string, signature: Signature): boolean {
  return signature.patterns.some((pattern) => pattern.test(haystack));
}

/** Returns the display names of every signature in `catalogue` present in `haystack`. */
export function detect(haystack: string, catalogue: readonly Signature[]): string[] {
  const found: string[] = [];
  for (const signature of catalogue) {
    if (matches(haystack, signature) && !found.includes(signature.name)) found.push(signature.name);
  }
  return found;
}

// ---------- §5.6 Advertising: tracking, pixels, tags ----------

/** D4 / part of D1. Analytics proper — measurement without an advertising intent behind it. */
export const ANALYTICS_SIGNATURES: readonly Signature[] = [
  { name: "Google Analytics 4", patterns: [/googletagmanager\.com\/gtag\/js\?id=g-/i, /gtag\(\s*['"]config['"]\s*,\s*['"]g-/i] },
  { name: "Google Tag Manager", patterns: [/googletagmanager\.com\/gtm\.js/i, /gtm-[a-z0-9]{4,9}/i] },
  { name: "Universal Analytics", patterns: [/google-analytics\.com\/(analytics|ga)\.js/i, /ua-\d{4,10}-\d{1,4}/i] },
  { name: "Plausible", patterns: [/plausible\.io\/js/i] },
  { name: "Fathom", patterns: [/cdn\.usefathom\.com/i] },
  { name: "Matomo", patterns: [/matomo\.js|piwik\.js/i] },
  { name: "Microsoft Clarity", patterns: [/clarity\.ms\/tag/i] },
  { name: "Hotjar", patterns: [/static\.hotjar\.com|hjsv=/i] },
  { name: "Segment", patterns: [/cdn\.segment\.(com|io)\/analytics\.js/i] },
  { name: "Mixpanel", patterns: [/cdn\.mxpnl\.com/i] },
  { name: "Heap", patterns: [/cdn\.heapanalytics\.com/i] },
  { name: "StatCounter", patterns: [/statcounter\.com\/counter/i] },
  { name: "Wix Analytics", patterns: [/static\.parastorage\.com\/services\/wix-perf/i] },
];

/** D2. */
export const META_PIXEL_SIGNATURES: readonly Signature[] = [
  { name: "Meta Pixel", patterns: [/connect\.facebook\.net\/[^"']*\/fbevents\.js/i, /fbq\(\s*['"]init['"]/i, /facebook\.com\/tr\?id=/i] },
];

/** D3. */
export const GOOGLE_ADS_SIGNATURES: readonly Signature[] = [
  { name: "Google Ads tag", patterns: [/gtag\(\s*['"]config['"]\s*,\s*['"]aw-/i, /googleadservices\.com\/pagead\/conversion/i, /google_conversion_id/i, /aw-\d{9,12}/i] },
];

/**
 * D6. Retargeting is *audience building*, not measurement: a tag that exists so the business can
 * show ads to this visitor again later. The Meta Pixel qualifies on its own — that is its primary
 * purpose — and so do the remarketing-specific tags below.
 */
export const RETARGETING_SIGNATURES: readonly Signature[] = [
  ...META_PIXEL_SIGNATURES,
  { name: "Google remarketing", patterns: [/googleadservices\.com\/pagead\/conversion/i, /googleads\.g\.doubleclick\.net/i, /doubleclick\.net\/pagead/i] },
  { name: "LinkedIn Insight Tag", patterns: [/snap\.licdn\.com\/li\.lms-analytics/i, /_linkedin_partner_id/i] },
  { name: "X (Twitter) pixel", patterns: [/static\.ads-twitter\.com\/uwt\.js/i, /twq\(\s*['"](init|config)['"]/i] },
  { name: "TikTok pixel", patterns: [/analytics\.tiktok\.com\/i18n\/pixel/i, /ttq\.load\(/i] },
  { name: "Pinterest tag", patterns: [/s\.pinimg\.com\/ct\/core\.js/i, /pintrk\(/i] },
  { name: "Snap Pixel", patterns: [/sc-static\.net\/scevent/i] },
];

// ---------- §5.5 Social ----------

export interface SocialPlatform {
  name: string;
  /** Matches a link to the business's own profile. */
  profile: RegExp;
  /**
   * Matches share/intent links, which are *not* evidence of a profile — a "share this on
   * Facebook" button appears on sites whose owner has no Facebook page at all, and counting it
   * would mean O2 quietly never fires on any site with a share widget.
   */
  share?: RegExp;
}

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  { name: "Facebook", profile: /(?:^|\/\/|\.)facebook\.com\//i, share: /facebook\.com\/(sharer|share\.php|dialog|plugins|tr\?)/i },
  { name: "Instagram", profile: /(?:^|\/\/|\.)instagram\.com\//i, share: /instagram\.com\/(p|reel|explore)\//i },
  { name: "X", profile: /(?:^|\/\/|\.)(twitter|x)\.com\//i, share: /(twitter|x)\.com\/(intent|share|home\?status)/i },
  { name: "LinkedIn", profile: /(?:^|\/\/|\.)linkedin\.com\//i, share: /linkedin\.com\/(shareArticle|sharing|cws)/i },
  { name: "YouTube", profile: /(?:^|\/\/|\.)(youtube\.com|youtu\.be)\//i, share: /youtube\.com\/(embed|iframe_api)/i },
  { name: "TikTok", profile: /(?:^|\/\/|\.)tiktok\.com\//i, share: /tiktok\.com\/(embed|share)/i },
  { name: "Pinterest", profile: /(?:^|\/\/|\.)pinterest\.[a-z.]{2,6}\//i, share: /pinterest\.[a-z.]{2,6}\/pin\/create/i },
  { name: "Threads", profile: /(?:^|\/\/|\.)threads\.(net|com)\//i },
  { name: "Snapchat", profile: /(?:^|\/\/|\.)snapchat\.com\/add\//i },
  { name: "Nextdoor", profile: /(?:^|\/\/|\.)nextdoor\.com\//i },
];

// ---------- §6.3 N10: paid third-party widgets ----------

/** Live chat. Every one of these is a paid product at any usable volume. */
export const CHAT_WIDGET_SIGNATURES: readonly Signature[] = [
  { name: "Intercom", patterns: [/widget\.intercom\.io|intercomcdn\.com/i] },
  { name: "Drift", patterns: [/js\.driftt\.com|drift\.com\/include/i] },
  { name: "Tawk.to", patterns: [/embed\.tawk\.to/i] },
  { name: "Crisp", patterns: [/client\.crisp\.chat/i] },
  { name: "LiveChat", patterns: [/cdn\.livechatinc\.com/i] },
  { name: "Tidio", patterns: [/code\.tidio\.co/i] },
  { name: "HubSpot", patterns: [/js\.hs-scripts\.com|js\.hsforms\.net|hs-analytics\.net/i] },
  { name: "Zendesk", patterns: [/static\.zdassets\.com|zopim\.com/i] },
  { name: "Podium", patterns: [/connect\.podium\.com/i] },
  { name: "Olark", patterns: [/static\.olark\.com/i] },
  { name: "Freshchat", patterns: [/wchat\.freshchat\.com/i] },
  { name: "Birdeye", patterns: [/birdeye\.com\/embed|bwidget\.js/i] },
];

/** Booking and scheduling — also what K8 accepts as "a way to request a quote or booking". */
export const BOOKING_WIDGET_SIGNATURES: readonly Signature[] = [
  { name: "Calendly", patterns: [/calendly\.com/i] },
  { name: "Acuity Scheduling", patterns: [/acuityscheduling\.com|squarespacescheduling\.com/i] },
  { name: "Square Appointments", patterns: [/squareup\.com\/appointments|square\.site\/book/i] },
  { name: "Mindbody", patterns: [/mindbodyonline\.com|brandedweb\.mindbodyonline/i] },
  { name: "Booksy", patterns: [/booksy\.com/i] },
  { name: "Vagaro", patterns: [/vagaro\.com/i] },
  { name: "Setmore", patterns: [/setmore\.com/i] },
  { name: "Housecall Pro", patterns: [/housecallpro\.com/i] },
  { name: "Jobber", patterns: [/getjobber\.com|clienthub\.getjobber/i] },
  { name: "ServiceTitan", patterns: [/servicetitan\.com/i] },
  { name: "OpenTable", patterns: [/opentable\.com/i] },
  { name: "Resy", patterns: [/resy\.com/i] },
  { name: "Schedulicity", patterns: [/schedulicity\.com/i] },
  { name: "Appointy", patterns: [/appointy\.com/i] },
];

/** Marketing / CRM capture. Paying for these is a spending signal in its own right. */
export const CRM_WIDGET_SIGNATURES: readonly Signature[] = [
  { name: "Mailchimp", patterns: [/list-manage\.com|chimpstatic\.com|mailchimp\.com\/embed/i] },
  { name: "Klaviyo", patterns: [/static\.klaviyo\.com|klaviyo\.js/i] },
  { name: "ActiveCampaign", patterns: [/activehosted\.com|activecampaign\.com\/f\/embed/i] },
  { name: "Constant Contact", patterns: [/ctctcdn\.com|constantcontact\.com\/signup/i] },
  { name: "ConvertKit", patterns: [/convertkit\.com\/.*\/index\.js|ck\.page/i] },
  { name: "Typeform", patterns: [/embed\.typeform\.com|typeform\.com\/to\//i] },
  { name: "JotForm", patterns: [/jotform\.com\/(jsform|form)/i] },
  { name: "Gravity Forms", patterns: [/gravityforms|gform_wrapper/i] },
];

// ---------- §5.4 R6: reviews shown on the site ----------

export const REVIEW_WIDGET_SIGNATURES: readonly Signature[] = [
  { name: "Trustpilot", patterns: [/widget\.trustpilot\.com|trustpilot\.com\/review/i] },
  { name: "Yotpo", patterns: [/staticw2\.yotpo\.com|yotpo\.com\/widget/i] },
  { name: "Birdeye reviews", patterns: [/birdeye\.com\/(embed|reviews)/i] },
  { name: "Podium reviews", patterns: [/podium\.com\/(widget|reviews)/i] },
  { name: "Elfsight reviews", patterns: [/elfsight\.com\/.*(google-reviews|reviews)/i] },
  { name: "Reviews.io", patterns: [/reviews\.io\/|reviewsio/i] },
  { name: "Google reviews embed", patterns: [/google\.com\/maps\/place\/[^"']*reviews|featurable\.com/i] },
  { name: "Judge.me", patterns: [/judge\.me\/|judgeme/i] },
  { name: "Grade.us", patterns: [/grade\.us/i] },
  { name: "NiceJob", patterns: [/nicejob\.co|nicejob\.com/i] },
];

// ---------- §5.1 W8: dated site platforms ----------

export interface PlatformSignature extends Signature {
  /**
   * True when the platform itself is the finding — a builder that has been end-of-life or
   * visibly dated for years. A current Wix or Squarespace site is not a problem and must not be
   * reported as one; only the platforms below are.
   */
  dated: boolean;
  /** Why, in the words an operator would use on a call. */
  why: string;
  /**
   * Matched against `<meta name="generator">` alone, where a platform names itself in plain words
   * rather than through a CDN host. Weebly's generator tag says exactly "Weebly" and nothing
   * else — a host pattern looking for `weebly.com` never sees it.
   */
  generator?: RegExp;
}

export const PLATFORM_SIGNATURES: readonly PlatformSignature[] = [
  { name: "Weebly", dated: true, why: "Weebly has been effectively frozen since Square acquired it", generator: /weebly/i, patterns: [/weebly\.com|weeblycloud|editmysite\.com/i] },
  { name: "GoDaddy Website Builder", dated: true, why: "GoDaddy's older site builder", generator: /godaddy|website ?builder/i, patterns: [/godaddysites\.com|starfieldtech|websitebuilder\.godaddy/i] },
  { name: "Wix (legacy HTML editor)", dated: true, why: "Wix's pre-2016 HTML editor, which Wix itself no longer develops", patterns: [/wix\.com\/.*html5|wixstatic\.com\/.*\/html\//i] },
  { name: "Adobe Muse", dated: true, why: "Adobe discontinued Muse in 2020", generator: /muse/i, patterns: [/adobe muse|musecdn/i] },
  { name: "Microsoft FrontPage", dated: true, why: "FrontPage was discontinued in 2003", generator: /frontpage/i, patterns: [/frontpage\.editor|_vti_bin|microsoft frontpage/i] },
  { name: "Joomla 1-3", dated: true, why: "Joomla 3 reached end of life in 2023", generator: /joomla!? ?[123]\b/i, patterns: [/joomla!? ?[123]\./i] },
  { name: "Drupal 7", dated: true, why: "Drupal 7 reached end of life in 2025", generator: /drupal ?7\b/i, patterns: [/drupal ?7\b/i] },
  { name: "Homestead", dated: true, why: "a builder from the early 2000s", generator: /homestead/i, patterns: [/homestead\.com|homesteadcloud/i] },
  { name: "Yola", dated: true, why: "a long-dormant site builder", generator: /yola/i, patterns: [/yola\.com|yolasite\.com/i] },
  { name: "Web.com builder", dated: true, why: "Web.com's older builder", patterns: [/web\.com\/builder|websitebuilder\.web\.com/i] },
  // Detected but explicitly NOT dated — present so the check can say what a site IS built on
  // rather than only what it is not, and so a current platform never trips W8.
  { name: "WordPress", dated: false, why: "", generator: /wordpress/i, patterns: [/wp-content|wp-includes|wordpress/i] },
  { name: "Squarespace", dated: false, why: "", generator: /squarespace/i, patterns: [/squarespace\.com|sqsp\.net|static1\.squarespace/i] },
  { name: "Shopify", dated: false, why: "", generator: /shopify/i, patterns: [/cdn\.shopify\.com|myshopify\.com/i] },
  { name: "Wix", dated: false, why: "", generator: /wix/i, patterns: [/wix\.com|wixstatic\.com|parastorage\.com/i] },
  { name: "Webflow", dated: false, why: "", generator: /webflow/i, patterns: [/webflow\.com|assets\.website-files\.com/i] },
  { name: "Duda", dated: false, why: "", generator: /duda/i, patterns: [/dudaone|duda\.co|multiscreensite\.com/i] },
  { name: "BigCommerce", dated: false, why: "", generator: /bigcommerce/i, patterns: [/bigcommerce\.com/i] },
];

/**
 * §5.3 S9: schema.org types that ARE a LocalBusiness. The list is explicit rather than a pattern
 * because "LocalBusiness" is a supertype most sites never name directly — a dentist's site
 * declares `Dentist`, and treating that as no local markup would fire S9 on a site that did the
 * job correctly.
 */
export const LOCAL_BUSINESS_SCHEMA_TYPES: readonly string[] = [
  "localbusiness", "store", "professionalservice", "homeandconstructionbusiness",
  "automotivebusiness", "foodestablishment", "restaurant", "cafeorcoffeeshop", "bakery",
  "bar", "barorpub", "fastfoodrestaurant", "icecreamshop", "medicalbusiness", "dentist",
  "physician", "hospital", "pharmacy", "veterinarycare", "healthandbeautybusiness",
  "beautysalon", "hairsalon", "daysspa", "nailsalon", "tattooparlor", "healthclub",
  "sportsactivitylocation", "gym", "yogastudio", "legalservice", "attorney", "notary",
  "accountingservice", "insuranceagency", "financialservice", "realestateagent",
  "generalcontractor", "plumber", "electrician", "hvacbusiness", "roofingcontractor",
  "housepainter", "locksmith", "movingcompany", "movingandstorage", "autorepair", "autobodyshop",
  "autodealer", "autopartsstore", "autowash", "gasstation", "childcare", "dryclearningorlaundry",
  "drycleaningorlaundry", "emergencyservice", "employmentagency", "entertainmentbusiness",
  "selfstorage", "shoppingcenter", "travelagency", "touristinformationcenter", "lodgingbusiness",
  "hotel", "motel", "bedandbreakfast", "campground", "clothingstore", "florist",
  "furniturestore", "gardenstore", "groceryorsupermarket", "hardwarestore", "homegoodsstore",
  "jewelrystore", "liquorstore", "mobilephonestore", "officeequipmentstore", "petstore",
  "shoestore", "sportinggoodsstore", "tirestore", "toystore", "wholesalestore", "bookstore",
  "bikestore", "computerstore", "convenience store", "convenienceStore", "departmentstore",
  "electronicsstore", "musicstore", "outletstore", "pawnshop", "childrensclothingstore",
  "recyclingcenter", "school", "preschool", "elementaryschool", "middleschool", "highschool",
  "collegeoruniversity", "library", "museum", "park", "playground", "placeofworship", "church",
  "internetcafe", "radiostation", "televisionstation", "animalshelter", "governmentoffice",
  "postoffice", "policestation", "firestation", "printshop",
];

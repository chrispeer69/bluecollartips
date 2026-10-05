import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const customerRoute = await readFile(
  new URL("../src/routes/$companySlug/d/$driverSlug.tsx", import.meta.url),
  "utf8",
);
const stripeFunctions = await readFile(
  new URL("../src/lib/stripe.functions.ts", import.meta.url),
  "utf8",
);
const stripeLedger = await readFile(
  new URL("../src/lib/stripe-tip-ledger.server.ts", import.meta.url),
  "utf8",
);
const driverDashboard = await readFile(
  new URL("../src/routes/dashboard/driver.tsx", import.meta.url),
  "utf8",
);
const adminDashboard = await readFile(
  new URL("../src/routes/dashboard/admin.tsx", import.meta.url),
  "utf8",
);
const locationFunctions = await readFile(
  new URL("../src/lib/locations.functions.ts", import.meta.url),
  "utf8",
);
const photoUploader = await readFile(
  new URL("../src/components/ProfilePhotoUploader.tsx", import.meta.url),
  "utf8",
);
const photoServer = await readFile(
  new URL("../src/lib/profile-photo.server.ts", import.meta.url),
  "utf8",
);
const photoMigration = await readFile(
  new URL("../migrations/021_profile_photo_uploads.sql", import.meta.url),
  "utf8",
);
const tipWebhookMigration = await readFile(
  new URL("../migrations/022_separate_tip_webhook.sql", import.meta.url),
  "utf8",
);
const stripeWebhook = await readFile(
  new URL("../src/routes/api/public/webhooks/stripe.ts", import.meta.url),
  "utf8",
);
const publicFunctions = await readFile(
  new URL("../src/lib/public.functions.ts", import.meta.url),
  "utf8",
);
const companyRoute = await readFile(
  new URL("../src/routes/$companySlug/index.tsx", import.meta.url),
  "utf8",
);
const reviewSuggestions = await readFile(
  new URL("../src/lib/review-suggestions.ts", import.meta.url),
  "utf8",
);
const reviewQualityPicker = await readFile(
  new URL("../src/components/ReviewQualityPicker.tsx", import.meta.url),
  "utf8",
);
const reviewThankYou = await readFile(
  new URL("../src/components/ReviewThankYou.tsx", import.meta.url),
  "utf8",
);

test("customer review and tip are separate sequential steps", () => {
  assert.match(customerRoute, /step === "review"/);
  assert.match(customerRoute, /step === "tip"/);
  assert.match(customerRoute, /if \(stars >= 4\)/);
  assert.match(customerRoute, /Continue without a tip/);
  assert.doesNotMatch(customerRoute, /No tip —/);
  assert.doesNotMatch(customerRoute, /words<\/span>|characters<\/span>|wordCount\(feedback\)/);
  assert.match(customerRoute, /Your feedback matters to us/);
  assert.match(customerRoute, /h-24 w-24/);
  assert.doesNotMatch(customerRoute, /function finishTipStep\(\) \{[^}]*copyReviewText/s);
  assert.match(customerRoute, /DEFAULT_CUSTOMER_TIP_CENTS/);
  assert.match(customerRoute, /Your feedback matters to us/);
  assert.match(customerRoute, /review helps/);
  assert.match(customerRoute, /would love your support/);
  assert.doesNotMatch(customerRoute, /can not thank you enough/);
  assert.doesNotMatch(companyRoute, /can not thank you enough/);
});

test("post-tip handoff shows every enabled review destination without copying text", () => {
  assert.match(customerRoute, /<ReviewThankYou/);
  assert.match(companyRoute, /<ReviewThankYou/);
  assert.doesNotMatch(customerRoute, /window\.location\.assign\(positiveRedirectUrl\)/);
  assert.doesNotMatch(companyRoute, /window\.location\.assign\(result\.redirectUrl\)/);
  assert.match(reviewThankYou, /Help others choose with confidence/);
  assert.match(reviewThankYou, /A few words and a photo can help future customers/);
  assert.match(reviewThankYou, /Choose where to share/);
  assert.doesNotMatch(reviewThankYou, /Copy review|Review copied|window\.location\.assign/);
  assert.match(reviewThankYou, /reviewLinks\.map/);
  assert.match(reviewThankYou, /ReviewSiteMark/);
  assert.match(reviewThankYou, /aria-label="Close"/);
});

test("review badges stay separate from the customer's written review", () => {
  assert.match(reviewSuggestions, /REVIEW_QUALITIES/);
  assert.equal((reviewSuggestions.match(/id: "/g) ?? []).length, 6);
  assert.doesNotMatch(reviewSuggestions, /rotatingReviewQualities/);
  assert.doesNotMatch(reviewSuggestions, /composeReviewSentence|phrase:/);
  assert.match(customerRoute, /qualities=\{REVIEW_QUALITIES\}/);
  assert.match(customerRoute, /selectedQualities/);
  assert.match(customerRoute, /qualityBadges: selectedQualities/);
  assert.match(companyRoute, /qualities=\{REVIEW_QUALITIES\}/);
  assert.match(companyRoute, /qualityBadges: selectedQualities/);
  assert.doesNotMatch(companyRoute, /composeReviewSentence|Copy for public review/);
  assert.match(customerRoute, /Choose as many as apply/);
  assert.match(companyRoute, /Choose as many as apply/);
  assert.doesNotMatch(customerRoute, /Show fewer options|Show all 6 options/);
  assert.doesNotMatch(companyRoute, /Show fewer options|Show all 6 options/);
  assert.match(reviewQualityPicker, /rounded-full/);
  assert.match(reviewQualityPicker, /aria-pressed/);
  assert.match(reviewQualityPicker, /VISUALS/);
});

test("public review offers enabled destinations after a configurable threshold", () => {
  assert.doesNotMatch(customerRoute, /Review on Yelp|Review on Facebook|Review on Google/);
  assert.doesNotMatch(customerRoute, /positiveRedirectUrl/);
  assert.match(adminDashboard, /label="Google"/);
  assert.match(adminDashboard, /label="Yelp"/);
  assert.match(adminDashboard, /label="Facebook"/);
  assert.doesNotMatch(adminDashboard, /Redirect positive reviews to/);
  assert.match(adminDashboard, /Show public review sites for/);
  assert.match(adminDashboard, /All ratings/);
  assert.match(adminDashboard, /Show quick feedback badges/);
  assert.match(adminDashboard, /label="Apple Maps"/);
  assert.match(adminDashboard, /label="Bing Places"/);
  assert.match(adminDashboard, /label="US Tow Alliance"/);
  assert.match(adminDashboard, /Show \$\{label\} on the thank-you page/);
  assert.match(adminDashboard, /enabledSites/);
  assert.doesNotMatch(locationFunctions, /positiveReviewDestination|positive_redirect_url/);
  assert.match(locationFunctions, /positive_rating_threshold/);
  assert.match(locationFunctions, /review_badges_enabled/);
  assert.match(locationFunctions, /enabled_review_sites/);
  assert.match(locationFunctions, /google_review_url: data\.googleUrl/);
  assert.match(publicFunctions, /positive_rating_threshold/);
  assert.match(publicFunctions, /review_badges_enabled/);
  assert.doesNotMatch(publicFunctions, /positive_redirect_url/);
  assert.doesNotMatch(publicFunctions, /positive_submit_action === "redirect"/);
});

test("low and neutral ratings receive appropriate private thank-you copy", () => {
  assert.match(reviewThankYou, /Thank you for your feedback/);
  assert.match(reviewThankYou, /always striving to improve/);
  assert.match(reviewThankYou, /serve customers better/);
  assert.match(customerRoute, /if \(stars >= 4\)/);
});

test("the tip keeps the saved rating attribution", () => {
  assert.match(customerRoute, /ratingId=\{ratingId\}/);
  assert.match(stripeFunctions, /rating_id: data\.ratingId/);
  assert.match(stripeFunctions, /Rating does not belong to this tip page/);
  assert.match(stripeLedger, /rating_id: pi\.metadata\?\.rating_id/);
});

test("a newly recorded Stripe tip notifies GHL once with workflow fields", () => {
  assert.match(stripeLedger, /event: "tip\.received"/);
  assert.match(stripeLedger, /tip_webhook_enabled/);
  assert.match(stripeLedger, /tip_webhook_url/);
  assert.match(stripeLedger, /tipReceived: "Yes"/);
  assert.match(stripeLedger, /tipAmountCents: pi\.amount/);
  assert.match(stripeLedger, /tippedAt/);
  assert.match(stripeLedger, /reviewText: rating\.feedback/);
  assert.match(stripeLedger, /ghlContactId: reviewContext\?\.external_contact_id/);
  assert.match(stripeLedger, /if \(!result\.recorded \|\| !result\.ratingId\) return/);
  assert.match(stripeWebhook, /if \(recorded\.recorded\)/);
  assert.match(stripeWebhook, /deliverRecordedTipWebhook/);
  assert.match(stripeFunctions, /if \(recorded\.recorded\)/);
  assert.match(stripeFunctions, /deliverRecordedTipWebhook/);
  assert.match(publicFunctions, /event: "review\.submitted"/);
  assert.match(publicFunctions, /driverName: driver\.display_name/);
  assert.match(publicFunctions, /tipUrl/);
  assert.match(publicFunctions, /submittedRatingId/);
  assert.match(customerRoute, /tipMode === "1"/);
  assert.match(customerRoute, /setStep\("tip"\)/);
  assert.match(customerRoute, /setDone\(result\.tipAlreadyReceived\)/);
  assert.match(adminDashboard, /Send submitted reviews to this company’s webhook/);
  assert.match(adminDashboard, /Send successful tips to a separate webhook/);
  assert.match(tipWebhookMigration, /tip_webhook_enabled/);
  assert.match(tipWebhookMigration, /tip_webhook_url/);
});

test("driver photos have owner-admin editing and a neutral fallback", () => {
  assert.match(driverDashboard, /Company admins and the profile owner can update this picture/);
  assert.match(driverDashboard, /ProfilePhotoUploader/);
  assert.match(adminDashboard, /EmployeePhotoEditor/);
  assert.match(adminDashboard, /ProfilePhotoUploader/);
  assert.match(customerRoute, /profile photo placeholder/);
});

test("profile picture uploads are cropped, bounded, authorized, and rate limited", () => {
  assert.match(photoUploader, /15 MB or smaller/);
  assert.match(photoUploader, /Pinch, scroll, or use the slider to zoom/);
  assert.match(photoUploader, /onPointerMove/);
  assert.match(photoUploader, /OUTPUT_SIZE = 512/);
  assert.match(photoUploader, /image\/jpeg/);
  assert.match(photoServer, /isSameOrigin/);
  assert.match(photoServer, /APP_PUBLIC_URL/);
  assert.match(photoServer, /x-forwarded-host/);
  assert.match(photoServer, /sec-fetch-site/);
  assert.match(photoServer, /canEditDriver/);
  assert.match(photoServer, /MAX_UPLOADS_PER_HOUR/);
  assert.match(photoServer, /dimensions\.width !== 512/);
  assert.match(photoMigration, /byte_size <= 2097152/);
  assert.match(photoMigration, /driver_id uuid PRIMARY KEY/);
});

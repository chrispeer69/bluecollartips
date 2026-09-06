import postgres from "postgres";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
  throw new Error("Refusing to seed a non-local database");
}

const scrypt = promisify(scryptCallback);
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString("hex")}`;
}

const db = postgres(process.env.DATABASE_URL, { max: 1 });
const passwordHash = await hashPassword("password123");

await db.begin(async (tx) => {
  const [company] = await tx`
    insert into companies (
      name, slug, support_email, support_phone, primary_color, secondary_color,
      google_review_url, yelp_review_url, facebook_review_url,
      driver_pct, company_pct, platform_pct, thank_you_enabled
    ) values (
      'Blue Collar Demo Towing', 'blue-collar-demo', 'dispatch@bluecollardemo.local', '+1 555 010 1000',
      '#0F2A44', '#F97316', 'https://g.page/r/demo/review', 'https://yelp.com/biz/demo',
      'https://facebook.com/demo/reviews', 80, 10, 10, true
    ) on conflict (slug) do update set
      name = excluded.name, support_email = excluded.support_email, support_phone = excluded.support_phone
    returning id
  `;

  const users = [
    ["admin@bluecollartips.local", "Alex Admin", "+1 555 010 1001"],
    ["mike@bluecollartips.local", "Mike Rodriguez", "+1 555 010 1002"],
    ["sarah@bluecollartips.local", "Sarah Johnson", "+1 555 010 1003"],
    ["james@bluecollartips.local", "James Wilson", "+1 555 010 1004"],
  ];
  const userIds = new Map();
  for (const [email, fullName, phone] of users) {
    const [user] = await tx`
      insert into users (email, password_hash, full_name, phone)
      values (${email}, ${passwordHash}, ${fullName}, ${phone})
      on conflict (email) do update set password_hash = excluded.password_hash,
        full_name = excluded.full_name, phone = excluded.phone, updated_at = now()
      returning id
    `;
    userIds.set(email, user.id);
  }

  await tx`insert into user_roles (user_id, company_id, role) values (${userIds.get("admin@bluecollartips.local")}, ${company.id}, 'company_admin') on conflict do nothing`;

  const [north] = await tx`insert into locations (company_id, name, address) values (${company.id}, 'North Yard', '100 Industrial Way, Austin, TX') on conflict (company_id, name) do update set address = excluded.address returning id`;
  const [south] = await tx`insert into locations (company_id, name, address) values (${company.id}, 'South Yard', '2500 Highway 71, Austin, TX') on conflict (company_id, name) do update set address = excluded.address returning id`;

  const driverSpecs = [
    { email: "mike@bluecollartips.local", name: "Mike Rodriguez", slug: "mike-rodriguez", employee: "EMP-1001", location: north.id, venmo: "@Mike-Rodriguez", cashapp: "$MikeTows", stripe: "acct_demo_mike" },
    { email: "sarah@bluecollartips.local", name: "Sarah Johnson", slug: "sarah-johnson", employee: "EMP-1002", location: north.id, venmo: "@Sarah-Johnson", cashapp: "$SarahRoadside", stripe: "acct_demo_sarah" },
    { email: "james@bluecollartips.local", name: "James Wilson", slug: "james-wilson", employee: "EMP-1003", location: south.id, venmo: "@James-Wilson", cashapp: "$JamesTowing", stripe: null },
  ];
  const drivers = [];
  for (const spec of driverSpecs) {
    const [driver] = await tx`
      insert into drivers (
        company_id, user_id, location_id, display_name, slug, employee_id, email, phone,
        status, venmo_handle, cashapp_handle, zelle_handle, paypal_handle,
        stripe_account_id, stripe_onboarded, stripe_charges_enabled, stripe_payouts_enabled, notify_sms
      ) values (
        ${company.id}, ${userIds.get(spec.email)}, ${spec.location}, ${spec.name}, ${spec.slug}, ${spec.employee},
        ${spec.email}, ${users.find((u) => u[0] === spec.email)[2]}, 'active', ${spec.venmo}, ${spec.cashapp},
        ${spec.email}, ${spec.email}, ${spec.stripe}, ${!!spec.stripe}, ${!!spec.stripe}, ${!!spec.stripe}, true
      ) on conflict (company_id, slug) do update set
        user_id = excluded.user_id, location_id = excluded.location_id, display_name = excluded.display_name,
        email = excluded.email, phone = excluded.phone, status = 'active', stripe_account_id = excluded.stripe_account_id,
        stripe_onboarded = excluded.stripe_onboarded, stripe_charges_enabled = excluded.stripe_charges_enabled,
        stripe_payouts_enabled = excluded.stripe_payouts_enabled
      returning id, display_name
    `;
    drivers.push(driver);
    await tx`insert into user_roles (user_id, company_id, role) values (${userIds.get(spec.email)}, ${company.id}, 'driver') on conflict do nothing`;
  }

  // Mike belongs to a second company so the employee workspace switcher can
  // be exercised with the normal seeded login.
  const [secondCompany] = await tx`
    insert into companies (
      name, slug, support_email, primary_color, secondary_color,
      driver_pct, company_pct, platform_pct
    ) values (
      'Metro HVAC Demo', 'metro-hvac-demo', 'office@metrohvac.local',
      '#164E63', '#F59E0B', 80, 10, 10
    ) on conflict (slug) do update set name = excluded.name, support_email = excluded.support_email
    returning id
  `;
  await tx`
    insert into user_roles (user_id, company_id, role)
    values (${userIds.get("admin@bluecollartips.local")}, ${secondCompany.id}, 'company_admin')
    on conflict do nothing
  `;
  await tx`
    insert into drivers (
      company_id, user_id, display_name, slug, employee_id, email, phone,
      status, notify_sms
    ) values (
      ${secondCompany.id}, ${userIds.get("mike@bluecollartips.local")},
      'Mike Rodriguez', 'mike-rodriguez', 'HVAC-2001',
      'mike@bluecollartips.local', '+1 555 010 1002', 'active', true
    ) on conflict (company_id, slug) do update set
      user_id = excluded.user_id, email = excluded.email, phone = excluded.phone, status = 'active'
  `;
  await tx`
    insert into user_roles (user_id, company_id, role)
    values (${userIds.get("mike@bluecollartips.local")}, ${secondCompany.id}, 'driver')
    on conflict do nothing
  `;

  const feedback = [
    [drivers[0], 5, "[seed] Fast arrival and very professional service.", "Taylor Smith", 2500, "stripe"],
    [drivers[0], 4, "[seed] Helpful and careful with my vehicle.", "Jordan Lee", 1000, "cash"],
    [drivers[1], 5, "[seed] Sarah made a stressful situation easy.", "Morgan Davis", 2000, "stripe"],
    [drivers[1], 2, "[seed] Took longer than expected to arrive.", "Casey Brown", 500, "venmo"],
    [drivers[2], 5, "[seed] Excellent roadside assistance.", "Riley Taylor", 1500, "cashapp"],
  ];
  for (let index = 0; index < feedback.length; index++) {
    const [driver, stars, text, customer, amount, source] = feedback[index];
    const existing = await tx`select id from ratings where company_id = ${company.id} and feedback = ${text} limit 1`;
    if (existing.length) continue;
    const [rating] = await tx`
      insert into ratings (company_id, driver_id, stars, feedback, customer_name, customer_phone, customer_email, flagged, created_at)
      values (${company.id}, ${driver.id}, ${stars}, ${text}, ${customer}, ${`+15550102${String(index).padStart(2, "0")}`}, ${`customer${index + 1}@example.test`}, ${stars <= 2}, now() - (${index} * interval '3 days'))
      returning id
    `;
    await tx`
      insert into tips (
        company_id, driver_id, rating_id, amount_cents, source, customer_name,
        driver_amount_cents, company_amount_cents, platform_amount_cents, verified,
        verified_at, stripe_payment_intent_id, stripe_status, note, created_at
      ) values (
        ${company.id}, ${driver.id}, ${rating.id}, ${amount}, ${source}, ${customer}, 0, 0, 0,
        ${source === "stripe"}, ${source === "stripe" ? new Date() : null},
        ${source === "stripe" ? `pi_seed_${index + 1}` : null}, ${source === "stripe" ? "succeeded" : null},
        ${`[seed] Demo ${source} tip`}, now() - (${index} * interval '3 days')
      )
    `;
  }

  const lowRating = await tx`select id, driver_id from ratings where company_id = ${company.id} and stars = 2 and feedback like '[seed]%' limit 1`;
  if (lowRating[0]) {
    await tx`
      insert into discrepancy_flags (company_id, driver_id, reason, status, notes)
      select ${company.id}, ${lowRating[0].driver_id}, 'Low customer rating requires follow-up', 'open', '[seed] Contact customer and review dispatch timing'
      where not exists (select 1 from discrepancy_flags where company_id = ${company.id} and notes like '[seed]%')
    `;
  }
});

await db.end();
console.log("Local demo data ready");
console.log("Admin:  admin@bluecollartips.local / password123");
console.log("Drivers: mike@bluecollartips.local, sarah@bluecollartips.local, james@bluecollartips.local / password123");

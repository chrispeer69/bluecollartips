import test from "node:test";
import assert from "node:assert/strict";
import { vipReportCsv } from "../src/lib/vip.ts";

const row = {
  review_day: "2026-10-01", customer_name: '=HYPERLINK("x")', customer_email: "a@b.co", customer_phone: "+16145550100",
  stars: 5, google_clicked_at: null, google_posted_at: null,
};

test("vipReportCsv exports date, name, email, phone, stars, went to Google", () => {
  const csv = vipReportCsv([row, { ...row, customer_name: "Bo, Jr.", google_clicked_at: "2026-10-01T13:05:00Z" }]);
  const [head, first, second] = csv.split("\r\n");
  assert.equal(head, "﻿Date,Name,Email,Phone,Star rating,Went to Google");
  assert.equal(first, `2026-10-01,"'=HYPERLINK(""x"")",a@b.co,+16145550100,5,No`);
  assert.equal(second, `2026-10-01,"Bo, Jr.",a@b.co,+16145550100,5,Yes`);
});

import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { decodeAttachments, sniffImage } from "../src/lib/support-images.server.ts";

try { process.loadEnvFile?.(".env"); } catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Support chat integration tests only run against a local database");
}
const db = postgres(databaseUrl, { max: 1, transform: { undefined: null } });
const rollback = Symbol("rollback");

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG = Buffer.from("ffd8ffe000104a464946000101", "hex");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

test("support screenshots: recognised by content, not by label", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(JPEG), "image/jpeg");
  assert.equal(sniffImage(WEBP), "image/webp");
  assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)>")), null);

  const [png] = decodeAttachments([{ dataBase64: `data:image/jpeg;base64,${PNG.toString("base64")}` }]);
  assert.equal(png.contentType, "image/png", "the data-URL label is ignored");
  assert.throws(() => decodeAttachments([{ dataBase64: Buffer.from("hello").toString("base64") }]), /PNG, JPEG or WebP/);
  assert.throws(() => decodeAttachments(Array(5).fill({ dataBase64: PNG.toString("base64") })), /up to 4/);
  const huge = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
  assert.throws(() => decodeAttachments([{ dataBase64: huge.toString("base64") }]), /too large/);
  assert.deepEqual(decodeAttachments(undefined), []);
});

test("support chat schema: screenshot-only messages, attachment limits, read receipts", async () => {
  try {
    await db.begin(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const [company] = await tx`insert into companies (name, slug) values (${`Chat Co ${suffix}`}, ${`chat-co-${suffix}`}) returning id`;
      const [user] = await tx`insert into users (email, full_name) values (${`chat-${suffix}@example.com`}, 'Pat Tenant') returning id`;
      const [ticket] = await tx`
        insert into support_tickets (company_id, created_by, created_by_role, subject)
        values (${company.id}, ${user.id}, 'company_admin', 'Grey box on map') returning id`;
      const [message] = await tx`
        insert into support_messages (ticket_id, author_id, author_kind, body, page_url, client_info)
        values (${ticket.id}, ${user.id}, 'tenant', '', '/dashboard/admin', 'test-agent') returning id`;
      await tx`
        insert into support_attachments (ticket_id, message_id, uploaded_by, content_type, byte_size, data)
        values (${ticket.id}, ${message.id}, ${user.id}, 'image/png', ${PNG.length}, ${PNG})`;

      await assert.rejects(
        tx.savepoint((sp) => sp`
          insert into support_attachments (ticket_id, message_id, content_type, byte_size, data)
          values (${ticket.id}, ${message.id}, 'image/svg+xml', 10, ${PNG})`),
        /support_attachments_content_type_check/,
      );
      await assert.rejects(
        tx.savepoint((sp) => sp`
          insert into support_attachments (ticket_id, message_id, content_type, byte_size, data)
          values (${ticket.id}, ${message.id}, 'image/png', ${4 * 1024 * 1024}, ${PNG})`),
        /support_attachments_byte_size_check/,
      );

      await tx`update support_tickets set platform_last_read_at = now(), tenant_last_read_at = now() where id = ${ticket.id}`;
      const [row] = await tx`
        select t.platform_last_read_at is not null as seen,
               (select count(*) from support_attachments a where a.ticket_id = t.id)::int as pictures
        from support_tickets t where t.id = ${ticket.id}`;
      assert.equal(row.seen, true);
      assert.equal(row.pictures, 1);

      // Deleting the ticket takes its screenshots with it.
      await tx`delete from support_tickets where id = ${ticket.id}`;
      const [{ left }] = await tx`select count(*)::int as left from support_attachments where message_id = ${message.id}`;
      assert.equal(left, 0);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test("support chat wiring: widget mounted for tenants, screenshots access-checked", async () => {
  const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
  const [server, attachments, admin, driver, fns] = await Promise.all([
    read("src/server.ts"),
    read("src/lib/support-attachments.server.ts"),
    read("src/routes/dashboard/admin.tsx"),
    read("src/routes/dashboard/driver.tsx"),
    read("src/lib/support.functions.ts"),
  ]);
  assert.match(server, /handleSupportAttachmentRequest\(request\)/);
  assert.match(attachments, /if \(row\.internal\) return null/);
  assert.match(attachments, /Content-Security-Policy/);
  assert.match(admin, /!isPlatform && !data\.isSuper && <SupportChatWidget/);
  assert.match(driver, /!data\.viewingAsAdmin && <SupportChatWidget/);
  assert.match(fns, /assertCanPost\(context\.userId/);
});

test.after(async () => { await db.end(); });

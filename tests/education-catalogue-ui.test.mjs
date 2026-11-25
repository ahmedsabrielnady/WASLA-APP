import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = { "wasla.auth.session.v1": JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_at: 4102444800 }) };
globalThis.window = { location: { hostname: "wasla-app-gg2f.vercel.app" }, addEventListener() {} };
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem(k, v) { store[k] = v; }, removeItem(k) { delete store[k]; } };
const { dataApi } = await import("../src/supabase.js");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const CID = "11111111-1111-4111-8111-111111111111";

function mockFetch() {
  const calls = [];
  globalThis.fetch = async (url, o = {}) => { calls.push({ url: String(url), body: o.body ? JSON.parse(o.body) : null }); return new Response(JSON.stringify([]), { status: 200 }); };
  return calls;
}
const good = { title: "Algebra basics", subject: "Math", description: "d", lessons: 8, mode: "online", price: 300 };

test("course creation validates locally and calls only the checked RPC", async () => {
  const calls = mockFetch();
  for (const bad of [{ title: "ab" }, { subject: "x" }, { lessons: 0 }, { lessons: 201 }, { lessons: 2.5 }, { mode: "x" }, { price: -1 }, { price: 20001 }, { description: "x".repeat(1001) }]) {
    await assert.rejects(dataApi.teacherCreateCourse({ ...good, ...bad }));
  }
  assert.equal(calls.length, 0);
  await dataApi.teacherCreateCourse({ ...good, price: "" });
  assert.match(calls[0].url, /rpc\/teacher_create_course$/);
  assert.deepEqual(calls[0].body, { p_title: "Algebra basics", p_subject: "Math", p_description: "d", p_lessons: 8, p_mode: "online", p_price: 0 });
});

test("profile saving trims, splits subjects and validates the headline", async () => {
  const calls = mockFetch();
  await assert.rejects(dataApi.teacherSaveProfile({ headline: "ab", bio: "", subjects: "" }));
  await assert.rejects(dataApi.teacherSaveProfile({ headline: "Maths tutor", bio: "x".repeat(1001), subjects: "" }));
  assert.equal(calls.length, 0);
  await dataApi.teacherSaveProfile({ headline: " Maths tutor ", bio: " hi ", subjects: "Math، Physics, x, " });
  assert.deepEqual(calls[0].body, { p_headline: "Maths tutor", p_bio: "hi", p_subjects: ["Math", "Physics"] });
});

test("course toggle rejects a non-uuid and sends a strict boolean", async () => {
  const calls = mockFetch();
  await assert.rejects(dataApi.teacherSetCourseActive("1; drop", true));
  assert.equal(calls.length, 0);
  await dataApi.teacherSetCourseActive(CID, "yes");
  assert.deepEqual(calls[0].body, { p_course: CID, p_active: false });
});

test("catalogue UI never writes the tables directly and hides the teacher form from others", () => {
  assert.doesNotMatch(readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8"), /rest\/v1\/(courses|tutor_profiles)["`'?][^;]*method: "(POST|PATCH|DELETE)"/);
  assert.match(main, /state\.profile\?\.role !== "teacher" \|\| !Array\.isArray\(state\.teacherCourses\)/);
  assert.match(main, /state\.profile\?\.role === "teacher"\) return ""/);
});

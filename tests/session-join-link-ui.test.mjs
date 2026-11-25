import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");

test("the teacher can save a link only for an open online session and the page validates https before sending", () => {
  assert.match(main, /item\.status === "open" && item\.mode === "online" \? `<form class="session-link-form" data-form="teacher-session-link"/);
  assert.match(main, /const url = safeMeetingUrl\(new FormData\(form\)\.get\("url"\)\);\s*if \(!url\) throw/);
  assert.match(main, /if \(state\.profile\?\.role !== "teacher"\) throw[^\n]*\n\s*const url = safeMeetingUrl/);
  assert.match(api, /rpc\/teacher_set_session_link/);
});

test("only a booked student's card renders the link, as a new-tab anchor with noopener, and only for https", () => {
  assert.match(main, /e\.status === "booked" && safeMeetingUrl\(state\.sessionLinks\?\.\[e\.session_id\]\)/);
  assert.match(main, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(main, /href="\$\{escapeHTML\(state\.sessionLinks/);
  assert.match(api, /session_join_links\?select=session_id,url/);
});

test("the public session list never selects a url column", () => {
  assert.doesNotMatch(api, /tutor_sessions\?[^`]*url/);
});

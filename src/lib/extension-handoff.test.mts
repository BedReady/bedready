// The page half of the extension → /convert handoff (extension-handoff.ts). The extension half runs
// in a browser only; what can go wrong HERE is accepting something that is not a model file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handoffId, fileFromReply, receiveFromExtension, MAX_RECEIVE_BYTES } from "./extension-handoff.ts";

const b64 = (s: string) => Buffer.from(s).toString("base64");

test("only an id-shaped ext parameter is used", () => {
  assert.equal(handoffId("?ext=empadffogehgmbleajehbplobfajddnh&to=u1"), "empadffogehgmbleajehbplobfajddnh");
  assert.equal(handoffId("?ext=io.bedready.BedReady.Extension%20(ABCDE12345)"), "io.bedready.BedReady.Extension (ABCDE12345)");
  assert.equal(handoffId("?to=u1"), null);
  assert.equal(handoffId("?ext=%3Cscript%3E"), null);
  assert.equal(handoffId("?ext=" + "a".repeat(129)), null);
});

test("a reply becomes a File only when it is a model file", () => {
  const f = fileFromReply({ ok: true, name: "Benchy.3mf", b64: b64("PK…") });
  assert.ok(f);
  assert.equal(f!.name, "Benchy.3mf");
  assert.equal(f!.size, Buffer.from("PK…").length);
  // a path is reduced to its last part
  assert.equal(fileFromReply({ ok: true, name: "../../etc/Benchy.stl", b64: b64("x") })?.name, "Benchy.stl");
  for (const bad of [
    null, "nope", { ok: false, name: "a.3mf", b64: b64("x") }, { ok: true, name: "a.exe", b64: b64("x") },
    { ok: true, name: "a.3mf", b64: "%%%not base64" }, { ok: true, name: "a.3mf" },
    { ok: true, name: "a.3mf", b64: "A".repeat(Math.ceil(MAX_RECEIVE_BYTES / 3) * 4 + 4) },
  ]) assert.equal(fileFromReply(bad), null, JSON.stringify(bad)?.slice(0, 60));
});

test("no extension API, no file — and no hang", async () => {
  assert.equal(await receiveFromExtension("?ext=abc"), null);
  assert.equal(await receiveFromExtension("?to=u1"), null);
});

test("Chrome's callback form and Safari's promise form both deliver", async () => {
  const g = globalThis as unknown as { chrome?: unknown };
  const reply = { ok: true, name: "a.3mf", b64: b64("hello") };
  try {
    g.chrome = { runtime: { sendMessage: (_id: string, _m: unknown, cb: (r: unknown) => void) => { cb(reply); } } };
    assert.equal((await receiveFromExtension("?ext=abc"))?.name, "a.3mf");
    g.chrome = { runtime: { sendMessage: async () => reply } };
    assert.equal((await receiveFromExtension("?ext=abc"))?.size, 5);
  } finally {
    delete g.chrome;
  }
});

/* ============================================================
   ORIGNALS push-send — sends a Web Push to a device's stored
   subscription using OUR OWN VAPID keys (Supabase secrets). Uses
   the battle-tested web-push library (RFC 8291/8292). Target by
   device_key (exact) or shop_id (resolves the owner's device via
   the my_<first12> convention). Never throws to the caller.
   ============================================================ */
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const pub = Deno.env.get("VAPID_PUBLIC");
  const priv = Deno.env.get("VAPID_PRIVATE");
  if (!pub || !priv) return json({ ok: false, error: "push not configured" }, 503);

  try {
    const { device_key, shop_id, title, body, url } = await req.json();
    const SUPA = Deno.env.get("SUPABASE_URL")!;
    const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // resolve target subscription(s)
    let q = "";
    if (device_key) q = `device_key=eq.${encodeURIComponent(device_key)}`;
    else if (shop_id) q = `device_key=like.${encodeURIComponent(String(shop_id).replace(/^my_/, ""))}*`;
    else return json({ ok: false, error: "no target" }, 400);

    const r = await fetch(`${SUPA}/rest/v1/push_subscriptions?${q}&select=sub`, {
      headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    });
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return json({ ok: true, sent: 0 });

    webpush.setVapidDetails("mailto:support@orignals.shop", pub, priv);
    const payload = JSON.stringify({
      title: String(title || "Orignals").slice(0, 80),
      body: String(body || "").slice(0, 160),
      url: String(url || "./"),
    });

    let sent = 0;
    for (const row of rows) {
      try { await webpush.sendNotification(row.sub, payload); sent++; }
      catch (e) {
        // 404/410 = subscription expired → clean it up
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await fetch(`${SUPA}/rest/v1/push_subscriptions?sub->>endpoint=eq.${encodeURIComponent(row.sub.endpoint)}`, {
            method: "DELETE", headers: { apikey: SR, Authorization: `Bearer ${SR}` },
          }).catch(() => {});
        }
      }
    }
    return json({ ok: true, sent });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 400);
  }
});

// app.js — Wayra: Menú + Flujos + ChatGPT (CommonJS)
// package.json:
// {
//   "main": "app.js",
//   "scripts": {"start": "node app.js"},
//   "dependencies": { "express": "^4.18.2", "body-parser": "^1.20.2" }
// }

const express = require("express");
const bodyParser = require("body-parser");
const app = express();
app.use(bodyParser.json());

// ============ Config ============
const VERIFY_TOKEN = "wayra123"; // igual que en Meta

// (opcional) info negocio
const BUSINESS = process.env.BUSINESS_NAME || "Casa Wayra";
const CITY     = process.env.CITY || "Ibarra";

// ============ Precios/Promos ============
const PRICES = {
  sixpack: 9.99,
  barril_20l: 64.0,
  barril_30l: 89.0,
};
const PROMOS = [
  "🎶 Música en vivo – Viernes y Sábado 21:00.",
  "🍔 2x1 en burgers – Jueves 18–21.",
  `🍺 Sixpack artesanal desde $${PRICES.sixpack}.`,
];

// ============ Sesiones (memoria en RAM) ============
const sessions = new Map();
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      mode: "idle",                 // idle | reserve | beer
      history: [],                  // [{role, content}]
      reserve: { date: "", time: "", people: "", name: "" },
      beer: { kind: "", qty: "", delivery: "" },
      last: Date.now(),
    });
  }
  return sessions.get(userId);
}
function pushHistory(userId, role, content) {
  const s = getSession(userId);
  s.history.push({ role, content });
  if (s.history.length > 10) s.history = s.history.slice(-10);
  s.last = Date.now();
}

// ============ Helpers WhatsApp ============
async function waPOST(payload) {
  const url = `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  console.log("WA resp:", text);
  return { ok: r.ok, text };
}

async function sendText(to, body) {
  return waPOST({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

async function sendMainMenu(to) {
  return waPOST({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "¿Qué te gustaría hacer?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "reservar", title: "🗓️ Reservar mesa" } },
          { type: "reply", reply: { id: "promos",   title: "🔥 Promos/Eventos" } },
          { type: "reply", reply: { id: "cerveza",  title: "🍺 Pedir cerveza" } },
        ],
      },
    },
  });
}

async function sendBeerMenu(to) {
  const txt =
    `Opciones:\n` +
    `• Sixpack: $${PRICES.sixpack}\n` +
    `• Barril 20L: $${PRICES.barril_20l}\n` +
    `• Barril 30L: $${PRICES.barril_30l}\n\n` +
    `¿Qué formato prefieres? (sixpack / barril 20 / barril 30)`;
  await sendText(to, txt);
}

async function sendReserveAsk(to, step) {
  const prompts = {
    date: "¿Para qué fecha? (ej: 15/10)",
    time: "¿A qué hora? (ej: 20:00)",
    people: "¿Para cuántas personas?",
    name: "¿A nombre de quién?",
  };
  await sendText(to, prompts[step]);
}

// ============ Parsing de mensaje entrante ============
function extractUserText(msg) {
  const type = msg.type;
  if (type === "text") return (msg.text?.body || "").trim();
  if (type === "interactive") {
    const id = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || "";
    return id.trim();
  }
  return "";
}

// ============ Rutas utilitarias ============
app.get("/", (req, res) =>
  res.status(200).send("✅ Wayra webhook running. Usa /webhook para Meta.")
);
app.get("/healthz", (req, res) => res.sendStatus(200));

// Meta GET Verify
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ============ OpenAI ============
async function askGPT(messages) {
  const systemPrompt = `
Eres el asistente de ${BUSINESS} en ${CITY}. 
Objetivos principales:
1) Reservas (pregunta fecha, hora, nº de personas y nombre; confirma al final).
2) Promos/Eventos (menciona promos de la semana).
3) Pedidos de cerveza (sixpack/barril 20/30, cantidad y entrega/recogida; confirma al final).
Responde breve (≤ 280 caracteres), cálido, y termina con una pregunta clara para avanzar.
  `.trim();

  const body = {
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 220,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
  };

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error("OpenAI error:", await r.text());
      return null;
    }
    const data = await r.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error("OpenAI exception:", e);
    return null;
  }
}

// ============ Webhook POST (núcleo) ============
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = extractUserText(msg);
    const s = getSession(from);
    console.log("▶️ Entrante:", msg.type, text, "| mode:", s.mode);

    // ---- Inicio (idle) → botones o palabras clave ----
    if (s.mode === "idle") {
      const low = (text || "").toLowerCase();

      if (["reservar", "reserva"].includes(low)) {
        s.mode = "reserve";
        s.reserve = { date: "", time: "", people: "", name: "" };
        await sendText(from, "Perfecto, vamos con tu reserva.");
        await sendReserveAsk(from, "date");
        return res.sendStatus(200);
      }

      if (["promos", "promociones", "eventos"].includes(low)) {
        await sendText(from, "Nuestras promos y eventos:");
        await sendText(from, PROMOS.join("\n"));
        await sendMainMenu(from);
        return res.sendStatus(200);
      }

      if (["cerveza", "six", "sixpack", "barril"].includes(low)) {
        s.mode = "beer";
        s.beer = { kind: "", qty: "", delivery: "" };
        await sendText(from, "¡Vamos con tu pedido de cerveza!");
        await sendBeerMenu(from);
        return res.sendStatus(200);
      }

      // Si llega “hola” o algo genérico → mostrar menú + IA
      if (!low || /hola|buenas|menu|ayuda/.test(low)) {
        await sendMainMenu(from);
        // también podemos dejar que la IA salude de forma contextual
      }
    }

    // ---- Flujo RESERVA ----
    if (s.mode === "reserve") {
      if (!s.reserve.date)  { s.reserve.date = text; await sendReserveAsk(from, "time");   return res.sendStatus(200); }
      if (!s.reserve.time)  { s.reserve.time = text; await sendReserveAsk(from, "people"); return res.sendStatus(200); }
      if (!s.reserve.people){ s.reserve.people = text; await sendReserveAsk(from, "name");  return res.sendStatus(200); }
      if (!s.reserve.name)  {
        s.reserve.name = text;
        const conf = `✅ Reserva:\n📅 ${s.reserve.date}  ⏰ ${s.reserve.time}\n👥 ${s.reserve.people}  👤 ${s.reserve.name}\n\n¿Está correcto? (sí/no)`;
        await sendText(from, conf);
        return res.sendStatus(200);
      }
      if (/^si|sí|ok|correcto$/i.test(text)) {
        await sendText(from, "¡Listo! Te esperamos. ¿Algo más?");
        s.mode = "idle";
        await sendMainMenu(from);
        return res.sendStatus(200);
      }
      if (/^no|cancel/i.test(text)) {
        await sendText(from, "Reserva cancelada. ¿Quieres iniciar otra?");
        s.mode = "idle";
        await sendMainMenu(from);
        return res.sendStatus(200);
      }
      await sendText(from, "Responde “sí” para confirmar o “no” para cancelar.");
      return res.sendStatus(200);
    }

    // ---- Flujo CERVEZA ----
    if (s.mode === "beer") {
      if (!s.beer.kind) {
        const low = (text || "").toLowerCase();
        if (/six/.test(low)) s.beer.kind = "sixpack";
        else if (/20/.test(low)) s.beer.kind = "barril_20l";
        else if (/30/.test(low)) s.beer.kind = "barril_30l";
        else { await sendText(from, "Formato no válido. Escribe: sixpack / barril 20 / barril 30."); return res.sendStatus(200); }
        await sendText(from, "¿Cuántas unidades deseas?");
        return res.sendStatus(200);
      }
      if (!s.beer.qty)      { s.beer.qty = text; await sendText(from, "¿Entrega o recogida en local?"); return res.sendStatus(200); }
      if (!s.beer.delivery) {
        s.beer.delivery = text;
        const priceUnit = PRICES[s.beer.kind] || 0;
        const total = (Number(s.beer.qty) * priceUnit).toFixed(2);
        const conf = `✅ Pedido:\n🍺 ${s.beer.kind.replace("_"," ")} x ${s.beer.qty} = $${total}\n🚚 ${s.beer.delivery}\n\n¿Confirmamos? (sí/no)`;
        await sendText(from, conf);
        return res.sendStatus(200);
      }
      if (/^si|sí|ok|correcto$/i.test(text)) {
        await sendText(from, "¡Listo! Preparamos tu pedido. ¿Algo más?");
        s.mode = "idle";
        await sendMainMenu(from);
        return res.sendStatus(200);
      }
      if (/^no|cancel/i.test(text)) {
        await sendText(from, "Pedido cancelado. ¿Quieres ver otras opciones?");
        s.mode = "idle";
        await sendMainMenu(from);
        return res.sendStatus(200);
      }
      await sendText(from, "Responde “sí” para confirmar o “no” para cancelar.");
      return res.sendStatus(200);
    }

    // ---- No está en flujo → usa IA para contestar con lógica ----
    pushHistory(from, "user", text);
    let reply = await askGPT(s.history);
    if (!reply) reply = "¿Quieres reservar, ver promociones o pedir cerveza?";
    pushHistory(from, "assistant", reply);

    await sendText(from, reply);
    await sendMainMenu(from);
    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Error en webhook:", err);
    return res.sendStatus(200);
  }
});

// ============ Arranque ============
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("✅ Servidor corriendo en puerto " + PORT));

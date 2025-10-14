// app.js — Diagnóstico: Menú + Flujos (sin OpenAI)

const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// Config
const VERIFY_TOKEN = "wayra123";

// Memoria simple por usuario
const sessions = new Map();
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      mode: "idle", // idle | reserve | beer
      reserve: { date: "", time: "", people: "", name: "" },
      beer: { kind: "", qty: "", delivery: "" }
    });
  }
  return sessions.get(userId);
}

// Helpers WhatsApp
async function sendText(to, body) {
  const url = `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`;
  const payload = { messaging_product: "whatsapp", to, type: "text", text: { body } };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  console.log("WA sendText:", await r.text());
}

async function sendMainMenu(to) {
  const url = `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`;
  const payload = {
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
          { type: "reply", reply: { id: "cerveza",  title: "🍺 Pedir cerveza" } }
        ]
      }
    }
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  console.log("WA mainMenu:", await r.text());
}

function extractUserText(msg) {
  const type = msg.type;
  if (type === "text") return (msg.text?.body || "").trim();
  if (type === "interactive") {
    // IMPORTANTE: muchos se bloquean aquí; logeamos lo recibido
    const id = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || "";
    return id.trim();
  }
  return "";
}

// Health
app.get("/", (req, res) => res.status(200).send("✅ Wayra webhook running (diagnóstico sin IA)."));
app.get("/healthz", (req, res) => res.sendStatus(200));

// Verificación de Meta
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// Webhook mensajes
app.post("/webhook", async (req, res) => {
  try {
    console.log("📥 RAW BODY:", JSON.stringify(req.body, null, 2));

    const change = req.body?.entry?.[0]?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const txt = extractUserText(msg);
    const s = getSession(from);

    console.log("▶️ Entrante => type:", msg.type, "| text/id:", txt, "| mode:", s.mode);

    // ---- Intents inicio (idle) ----
    if (s.mode === "idle") {
      const low = (txt || "").toLowerCase();

      if (["reservar"].includes(low)) {
        s.mode = "reserve";
        s.reserve = { date: "", time: "", people: "", name: "" };
        await sendText(from, "Perfecto, vamos a reservar tu mesa.");
        await sendText(from, "¿Para qué fecha? (ej: 15/10)");
        return res.sendStatus(200);
      }

      if (["promos"].includes(low)) {
        await sendText(from,
          "Promos/eventos:\n• Música en vivo Viernes 21:00\n• 2x1 en cerveza hasta las 22:00\n• Sixpack artesanal desde $9.99"
        );
        await sendMainMenu(from);
        return res.sendStatus(200);
      }

      if (["cerveza"].includes(low)) {
        s.mode = "beer";
        s.beer = { kind: "", qty: "", delivery: "" };
        await sendText(from,
          "Opciones:\n• Sixpack ($9.99)\n• Barril 20L ($64)\n• Barril 30L ($89)\n\n¿Qué formato prefieres? (sixpack / barril 20 / barril 30)"
        );
        return res.sendStatus(200);
      }

      // Sin intención clara → menú
      if (!low || /hola|buenas|menu|ayuda/.test(low)) {
        await sendMainMenu(from);
        return res.sendStatus(200);
      }
    }

    // ---- Flujo RESERVA ----
    if (s.mode === "reserve") {
      if (!s.reserve.date) {
        s.reserve.date = txt;
        await sendText(from, "¿A qué hora? (ej: 20:00)");
        return res.sendStatus(200);
      }
      if (!s.reserve.time) {
        s.reserve.time = txt;
        await sendText(from, "¿Para cuántas personas?");
        return res.sendStatus(200);
      }
      if (!s.reserve.people) {
        s.reserve.people = txt;
        await sendText(from, "¿A nombre de quién?");
        return res.sendStatus(200);
      }
      if (!s.reserve.name) {
        s.reserve.name = txt;
        const resumen =
          `✅ Reserva lista:\n` +
          `📅 ${s.reserve.date} – ⏰ ${s.reserve.time}\n` +
          `👥 ${s.reserve.people} – 👤 ${s.reserve.name}\n\n` +
          `¿Está correcto? (sí/no)`;
        await sendText(from, resumen);
        return res.sendStatus(200);
      }
      if (/^si|sí|ok|correcto$/i.test(txt)) {
        await sendText(from, "¡Perfecto! Te esperamos. ¿Algo más?");
        s.mode = "idle";
        await sendMainMenu(from);
        return res.sendStatus(200);
      }
      if (/^no|cancel/i.test(txt)) {
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
        const low = txt.toLowerCase();
        if (/six/.test(low)) s.beer.kind = "sixpack";
        else if (/20/.test(low)) s.beer.kind = "barril 20L";
        else if (/30/.test(low)) s.beer.kind = "barril 30L";
        else {
          await sendText(from, "No entendí el formato. Escribe: sixpack / barril 20 / barril 30.");
          return res.sendStatus(200);
        }
        await sendText(from, "¿Cuántas unidades deseas?");
        return res.sendStatus(200);
      }
      if (!s.beer.qty) {
        s.beer.qty = txt;
        await sendText(from, "¿Entrega o recogida en local?");
        return res.sendStatus(200);
      }
      if (!s.beer.delivery) {
        s.beer.delivery = txt;
        const resumen =
          `✅ Pedido:\n` +
          `🍺 ${s.beer.kind} x ${s.beer.qty}\n` +
          `🚚 ${s.beer.delivery}\n\n` +
          `¿Confirmamos? (sí/no)`;
        await sendText(from, resumen);
        return res.sendStatus(200);
      }
      if (/^si|sí|ok|correcto$/i.test(txt)) {
        await sendText(from, "¡Listo! Preparamos tu pedido. ¿Algo más?");
        s.mode = "idle";
        await sendMainMenu(from);
        return res.sendStatus(200);
      }
      if (/^no|cancel/i.test(txt)) {
        await sendText(from, "Pedido cancelado. ¿Quieres ver otras opciones?");
        s.mode = "idle";
        await sendMainMenu(from);
        return res.sendStatus(200);
      }
      await sendText(from, "Responde “sí” para confirmar o “no” para cancelar.");
      return res.sendStatus(200);
    }

    // Si no encaja en nada (fallback)
    await sendText(from, "¿Quieres reservar, ver promociones o pedir cerveza?");
    await sendMainMenu(from);
    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Error en webhook:", err);
    return res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("✅ Servidor corriendo en puerto " + PORT));

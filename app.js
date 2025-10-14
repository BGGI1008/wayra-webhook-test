// app.js  — Casa Wayra WhatsApp + ChatGPT (CommonJS)
// Requisitos en package.json:
// {
//   "main": "app.js",
//   "scripts": { "start": "node app.js" },
//   "dependencies": { "express": "^4.18.2", "body-parser": "^1.20.2" }
// }
// Node 18+ ya trae fetch global (no necesitas node-fetch)

const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// ============ Configuración ============
// Debe coincidir con el token que pusiste en Meta Webhooks
const VERIFY_TOKEN = "wayra123";

// ============ Verificación del Webhook ============
// Meta verificará esta ruta al guardar el webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && token === VERIFY_TOKEN) {
    console.log("✅ Verificación de Meta completada");
    return res.status(200).send(challenge);
  }
  console.log("❌ Falló la verificación del webhook");
  return res.sendStatus(403);
});

// ============ Memoria de conversación ============
// (En plan Free, al “dormir” la instancia se pierde. Para producción, usar Redis/DB.)
const sessions = new Map(); // key: wa_id, value: { history: [{role, content}], last: ts }

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { history: [], last: Date.now() });
  }
  return sessions.get(userId);
}
function pushHistory(userId, role, content) {
  const s = getSession(userId);
  s.history.push({ role, content });
  if (s.history.length > 10) s.history = s.history.slice(-10); // límite de contexto
  s.last = Date.now();
}

// ============ Utilidades WhatsApp ============
async function sendText(to, body) {
  const url = `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  };
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

async function sendQuickMenu(to) {
  const url = `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "¡Hola! Soy el asistente de Casa Wayra. ¿Qué te gustaría hacer?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "reservar", title: "Reservar mesa" } },
          { type: "reply", reply: { id: "promos",   title: "Promociones" } },
          { type: "reply", reply: { id: "cerveza",  title: "Pedir cerveza" } }
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
  console.log("WA menu:", await r.text());
}

// Detecta texto o botones en el mensaje entrante
function extractUserText(msg) {
  const type = msg.type;
  if (type === "text") return msg.text?.body?.trim() || "";
  if (type === "interactive") {
    const br = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id;
    if (br === "reservar") return "Quiero reservar una mesa.";
    if (br === "promos")   return "Quiero ver promociones y eventos.";
    if (br === "cerveza")  return "Quiero pedir cerveza.";
    return br || "";
  }
  // otros tipos: image, audio, etc.
  return "";
}

// ============ Handler principal (ChatGPT + WhatsApp) ============
app.post("/webhook", async (req, res) => {
  try {
    const change = req.body?.entry?.[0]?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200); // eventos no-mensaje (entregas, lecturas, etc.)

    const from = msg.from;                    // número del cliente
    const userText = extractUserText(msg);    // texto o id de botón mapeado
    console.log("▶️ Entrante:", msg.type, JSON.stringify(userText));

    const session = getSession(from);
    const isFresh = session.history.length === 0;

    // Si es conversación nueva y no hay texto útil, manda menú
    if (isFresh && !userText) {
      await sendQuickMenu(from);
      return res.sendStatus(200);
    }

    // Guarda turno del usuario en historial
    pushHistory(from, "user", userText || "");

    const systemPrompt = `
Eres el asistente oficial de ${process.env.BUSINESS_NAME || "Casa Wayra"} en ${process.env.CITY || "Ibarra"}.
Objetivos: 1) Reservas (fecha, hora, nº de personas, nombre), 2) Promociones/Eventos, 3) Pedidos de cerveza (barril/sixpack). 
No pidas datos de tarjeta. Estilo cálido, claro, máximo 320 caracteres. Termina SIEMPRE con una pregunta concreta para avanzar.
`.trim();

    // Llamada a OpenAI con memoria
    let replyText = "¡Hola! 🍻 ¿Reservar mesa, ver promociones o pedir cerveza?";
    try {
      const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.4,
          max_tokens: 220,
          messages: [
            { role: "system", content: systemPrompt },
            ...session.history
          ]
        })
      });

      if (aiResp.ok) {
        const data = await aiResp.json();
        replyText = (data.choices?.[0]?.message?.content || replyText).slice(0, 500);
      } else {
        const errText = await aiResp.text();
        console.error("❌ OpenAI no OK:", aiResp.status, errText);
      }
    } catch (e) {
      console.error("❌ OpenAI exception:", e);
    }

    // Guarda la respuesta del asistente y envía por WhatsApp
    pushHistory(from, "assistant", replyText);
    await sendText(from, replyText);

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error en webhook:", err);
    return res.sendStatus(200); // evita reintentos de Meta
  }
});

// ============ Arranque del servidor ============
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("✅ Servidor corriendo en puerto " + PORT));

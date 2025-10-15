// app.js — Wayra: Menú lista + Horario/Menú (imagen) + Ubicación + Plan Wayra + Reservas (normal/especial) + Cerveza
// package.json recomendado:
// {
//   "main": "app.js",
//   "scripts": { "start": "node app.js" },
//   "dependencies": { "express": "^4.18.2", "body-parser": "^1.20.2" }
// }

const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// 1) Servir archivos estáticos desde /public (para /static/menu.jpg)
app.use("/static", express.static("public"));

// ====== CONFIG ======
const VERIFY_TOKEN = "wayra123"; // Debe coincidir con el de Webhooks en Meta

const BUSINESS = process.env.BUSINESS_NAME || "Wayra Brew Garten";
const CITY     = process.env.CITY || "Ibarra";

const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || ""; // https://TU-APP.onrender.com/static/menu.jpg
const MAPS_URL = process.env.MAPS_URL || "";
const MAP_LAT  = process.env.MAP_LAT ? Number(process.env.MAP_LAT) : null;
const MAP_LNG  = process.env.MAP_LNG ? Number(process.env.MAP_LNG) : null;

const PLAN_WAYRA_TEXT = process.env.PLAN_WAYRA_TEXT ||
  "🥤 PLAN WAYRA: todo a $2.\nDías: Lun–Jue 12–22, Vie–Sáb 12–00, Dom 12–20.";

const PRICES = {
  sixpack: 9.99,
  barril_20l: 64.0,
  barril_30l: 89.0,
};

// ====== SESIONES (RAM) ======
const sessions = new Map();
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      mode: "idle",               // idle | reserve | special | beer
      reserve: { date:"", time:"", people:"", name:"" },
      special: { occasion:"", date:"", time:"", people:"", name:"", notes:"" },
      beer: { kind:"", qty:"", delivery:"" },
      last: Date.now(),
    });
  }
  return sessions.get(userId);
}

// ====== HELPERS WHATSAPP ======
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
  return waPOST({ messaging_product: "whatsapp", to, type: "text", text: { body } });
}

async function sendImage(to, imageUrl, caption = "") {
  return waPOST({
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link: imageUrl, caption }
  });
}

async function sendLocation(to) {
  if (MAP_LAT !== null && MAP_LNG !== null) {
    await waPOST({
      messaging_product: "whatsapp",
      to,
      type: "location",
      location: {
        latitude: MAP_LAT,
        longitude: MAP_LNG,
        name: BUSINESS,
        address: `${BUSINESS} – ${CITY}`
      }
    });
  }
  if (MAPS_URL) {
    await sendText(to, `📍 Nuestra ubicación:\n${MAPS_URL}`);
  }
  await sendMainMenuList(to);
}

// Menú principal tipo LISTA
async function sendMainMenuList(to) {
  return waPOST({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: `Bienvenido a ${BUSINESS} 🍺` },
      body: { text: "Elige una opción:" },
      footer: { text: CITY },
      action: {
        button: "Ver opciones",
        sections: [
          {
            title: "Opciones",
            rows: [
              { id: "horario_menu",        title: "🕐 Horario y Menú" },
              { id: "ubicacion",           title: "📍 Ubicación" },
              { id: "plan_wayra",          title: "🥤 Plan Wayra ($2)" },
              { id: "reservas",            title: "🗓️ Reservas" },
              { id: "reservas_especiales", title: "🎉 Reservas especiales" },
              { id: "cerveza",             title: "🍺 Comprar cerveza" }
            ]
          }
        ]
      }
    }
  });
}

async function sendWelcome(to) {
  await sendMainMenuList(to);
}

// Horario y Menú (envía imagen si hay)
async function sendHoursAndMenu(to) {
  if (MENU_IMAGE_URL) {
    await sendImage(to, MENU_IMAGE_URL, `${BUSINESS} – ${CITY}\nMenú y horarios`);
  }
  const lines = [
    "🕐 Horario:",
    "Lun–Jue 12:00–22:00",
    "Vie–Sáb 12:00–00:00",
    "Dom 12:00–20:00",
    "",
    "¿Necesitas la carta? Si no ves la imagen, responde: *menú*."
  ];
  await sendText(to, lines.join("\n"));
  await sendMainMenuList(to);
}

// Cerveza
async function sendBeerMenu(to) {
  const txt =
    `Opciones de cerveza:\n` +
    `• Sixpack: $${PRICES.sixpack}\n` +
    `• Barril 20L: $${PRICES.barril_20l}\n` +
    `• Barril 30L: $${PRICES.barril_30l}\n\n` +
    `¿Qué formato prefieres? (sixpack / barril 20 / barril 30)`;
  await sendText(to, txt);
}

// Preguntas de reserva normal / especial
async function askReserve(to, step) {
  const prompts = {
    date:   "¿Para qué fecha? (ej: 15/10)",
    time:   "¿A qué hora? (ej: 20:00)",
    people: "¿Para cuántas personas?",
    name:   "¿A nombre de quién?"
  };
  await sendText(to, prompts[step]);
}
async function askSpecial(to, step) {
  const prompts = {
    occasion: "¿Qué ocasión es? (cumpleaños, aniversario, corporativo, etc.)",
    date:     "¿Para qué fecha? (ej: 15/10)",
    time:     "¿A qué hora? (ej: 20:00)",
    people:   "¿Para cuántas personas?",
    name:     "¿A nombre de quién?",
    notes:    "¿Algún requerimiento especial? (decoración, música, torta, etc.)"
  };
  await sendText(to, prompts[step]);
}

// ====== PARSING ENTRANTE ======
function extractUserText(msg) {
  const type = msg.type;
  if (type === "text") return (msg.text?.body || "").trim();
  if (type === "interactive") {
    const id = msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || "";
    return id.trim();
  }
  return "";
}

// ====== RUTAS ======
app.get("/", (req, res) => res.status(200).send("✅ Wayra webhook running."));
app.get("/healthz", (req, res) => res.sendStatus(200));

// Verificación GET (Meta)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// Webhook POST
app.post("/webhook", async (req, res) => {
  try {
    const change = req.body?.entry?.[0]?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = extractUserText(msg);
    const s = getSession(from);
    console.log("▶️ Entrante:", msg.type, text, "| mode:", s.mode);

    // IDLE → menú principal y comandos
    if (s.mode === "idle") {
      const low = (text || "").toLowerCase();

      if (text === "horario_menu" || /^(menú|menu|horario)$/i.test(low)) {
        await sendHoursAndMenu(from);
        return res.sendStatus(200);
      }

      if (text === "ubicacion" || /ubicación|ubicacion|donde/i.test(low)) {
        await sendLocation(from);
        return res.sendStatus(200);
      }

      if (text === "plan_wayra" || /plan wayra|plan/i.test(low)) {
        await sendText(from, PLAN_WAYRA_TEXT);
        await sendMainMenuList(from);
        return res.sendStatus(200);
      }

      if (text === "reservas" || /^reservar|reserva$/i.test(low)) {
        s.mode = "reserve";
        s.reserve = { date:"", time:"", people:"", name:"" };
        await sendText(from, "¡Perfecto! Vamos a reservar tu mesa.");
        await askReserve(from, "date");
        return res.sendStatus(200);
      }

      if (text === "reservas_especiales" || /especial/i.test(low)) {
        s.mode = "special";
        s.special = { occasion:"", date:"", time:"", people:"", name:"", notes:"" };
        await sendText(from, "¡Genial! Te ayudaré con tu ocasión especial.");
        await askSpecial(from, "occasion");
        return res.sendStatus(200);
      }

      if (text === "cerveza" || /cerveza|six|sixpack|barril/i.test(low)) {
        s.mode = "beer";
        s.beer = { kind:"", qty:"", delivery:"" };
        await sendText(from, "¡Vamos con tu pedido de cerveza!");
        await sendBeerMenu(from);
        return res.sendStatus(200);
      }

      if (!low || /hola|buenas|menu|menú|ayuda|inicio|start/i.test(low)) {
        await sendWelcome(from);
        return res.sendStatus(200);
      }
    }

    // RESERVA normal
    if (s.mode === "reserve") {
      if (!s.reserve.date)   { s.reserve.date = text; await askReserve(from, "time");   return res.sendStatus(200); }
      if (!s.reserve.time)   { s.reserve.time = text; await askReserve(from, "people"); return res.sendStatus(200); }
      if (!s.reserve.people) { s.reserve.people = text; await askReserve(from, "name");  return res.sendStatus(200); }
      if (!s.reserve.name)   {
        s.reserve.name = text;
        const conf = `✅ Reserva:\n📅 ${s.reserve.date}  ⏰ ${s.reserve.time}\n👥 ${s.reserve.people}  👤 ${s.reserve.name}\n\n¿Está correcto? (sí/no)`;
        await sendText(from, conf);
        return res.sendStatus(200);
      }
      if (/^si|sí|ok|correcto$/i.test(text)) {
        await sendText(from, "¡Listo! Te esperamos. ¿Algo más?");
        s.mode = "idle";
        await sendMainMenuList(from);
        return res.sendStatus(200);
      }
      if (/^no|cancel/i.test(text)) {
        await sendText(from, "Reserva cancelada. ¿Quieres iniciar otra?");
        s.mode = "idle";
        await sendMainMenuList(from);
        return res.sendStatus(200);
      }
      await sendText(from, "Responde “sí” para confirmar o “no” para cancelar.");
      return res.sendStatus(200);
    }

    // RESERVA especial
    if (s.mode === "special") {
      if (!s.special.occasion){ s.special.occasion = text; await askSpecial(from, "date");   return res.sendStatus(200); }
      if (!s.special.date)    { s.special.date = text;     await askSpecial(from, "time");   return res.sendStatus(200); }
      if (!s.special.time)    { s.special.time = text;     await askSpecial(from, "people"); return res.sendStatus(200); }
      if (!s.special.people)  { s.special.people = text;   await askSpecial(from, "name");   return res.sendStatus(200); }
      if (!s.special.name)    { s.special.name = text;     await askSpecial(from, "notes");  return res.sendStatus(200); }
      if (!s.special.notes)   {
        s.special.notes = text;
        const conf =
          `✅ Reserva especial:\n` +
          `🎉 ${s.special.occasion}\n` +
          `📅 ${s.special.date}  ⏰ ${s.special.time}\n` +
          `👥 ${s.special.people}  👤 ${s.special.name}\n` +
          `📝 ${s.special.notes}\n\n` +
          `¿Confirmamos? (sí/no)`;
        await sendText(from, conf);
        return res.sendStatus(200);
      }
      if (/^si|sí|ok|correcto$/i.test(text)) {
        await sendText(from, "¡Perfecto! Te contactaremos para coordinar detalles. ¿Algo más?");
        s.mode = "idle";
        await sendMainMenuList(from);
        return res.sendStatus(200);
      }
      if (/^no|cancel/i.test(text)) {
        await sendText(from, "Reserva especial cancelada. ¿Quieres ver otras opciones?");
        s.mode = "idle";
        await sendMainMenuList(from);
        return res.sendStatus(200);
      }
      await sendText(from, "Responde “sí” para confirmar o “no” para cancelar.");
      return res.sendStatus(200);
    }

    // CERVEZA
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
        await sendMainMenuList(from);
        return res.sendStatus(200);
      }
      if (/^no|cancel/i.test(text)) {
        await sendText(from, "Pedido cancelado. ¿Quieres ver otras opciones?");
        s.mode = "idle";
        await sendMainMenuList(from);
        return res.sendStatus(200);
      }
      await sendText(from, "Responde “sí” para confirmar o “no” para cancelar.");
      return res.sendStatus(200);
    }

    await sendMainMenuList(from);
    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Error en webhook:", err);
    return res.sendStatus(200);
  }
});

// ====== ARRANQUE ======
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("✅ Servidor corriendo en puerto " + PORT));

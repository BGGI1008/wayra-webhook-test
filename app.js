// app.js — Wayra: Bienvenida + Menú (lista) + Horario/Menú (imagen) + Ubicación + Plan Wayra + Reservas (normal/especial) + Cerveza
// package.json recomendado:
// {
//   "main": "app.js",
//   "scripts": { "start": "node app.js" },
//   "dependencies": { "express": "^4.18.2", "body-parser": "^1.20.2" },
//   "engines": { "node": ">=18" }
// }

const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// (OPCIONAL) Sirve archivos estáticos desde /public → /static/... (para alojar menu.jpg en Render)
// Descomenta si subiste public/menu.jpg a tu repo:
// app.use("/static", express.static("public"));

// ====== CONFIG ======
const VERIFY_TOKEN    = process.env.VERIFY_TOKEN || "wayra123";
const WHATSAPP_TOKEN  = process.env.WHATSAPP_TOKEN;      // token Meta
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;     // ID del número

const BUSINESS = process.env.BUSINESS_NAME || "Wayra Brew Garten";
const CITY     = process.env.CITY || "Ibarra";

const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || ""; // ej: https://TU-APP.onrender.com/static/menu.jpg
const MAPS_URL = process.env.MAPS_URL || "";
const MAPS_LAT = process.env.MAPS_LAT ? Number(process.env.MAPS_LAT) : null;
const MAPS_LNG = process.env.MAPS_LNG ? Number(process.env.MAPS_LNG) : null;

const PLAN_WAYRA_TEXT = process.env.PLAN_WAYRA_TEXT ||
  "🥤 PLAN WAYRA: todo a $2. Jue–Vie 18h–23h30, Sáb 12h30–23h30, Dom 12h30–19h00.";

// Precios simples (ajusta a gusto)
const PRICES = {
  sixpack: 9.99,
  barril_20l: 64.0,
  barril_30l: 89.0,
};

// ====== SESIONES (RAM) ======
const sessions = new Map(); // key: wa_id
function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      greeted: false,         // ya saludó
      mode: "idle",           // idle | reserve | special | beer
      reserve: { date:"", time:"", people:"", name:"" },
      special: { occasion:"", date:"", time:"", people:"", name:"", notes:"" },
      beer: { kind:"", qty:"", delivery:"" },
      updatedAt: Date.now(),
    });
  }
  return sessions.get(userId);
}

// ====== HELPERS WHATSAPP ======
async function waPOST(payload) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
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

// Menú principal tipo LISTA (más de 3 opciones)
async function sendMainMenuList(to) {
  return waPOST({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: `🍻 Bienvenido a ${BUSINESS}` },
      body: { text: "¿Qué te gustaría hacer?" },
      footer: { text: CITY },
      action: {
        button: "Ver opciones",
        sections: [
          {
            title: "Opciones disponibles",
            rows: [
              { id: "reservas",            title: "🗓️ Reservar mesa" },
              { id: "cerveza",             title: "🍺 Comprar cerveza" },
              { id: "promos",              title: "🔥 Promos/Eventos" },
              { id: "horario_menu",        title: "🕐 Horarios y ver menú" },
              { id: "ubicacion",           title: "📍 Ubicación" },
              { id: "reservas_especiales", title: "🎉 Reservas especiales" }
            ]
          }
        ]
      }
    }
  });
}

async function sendWelcome(to, s) {
  if (!s.greeted) {
    await sendText(to, "👋 ¡Hola! Soy el asistente de *Wayra Brew Garten* en Ibarra.\nTe ayudo con reservas, promos y pedidos de cerveza.");
    s.greeted = true;
  }
  await sendMainMenuList(to);
}

// Horario y Menú → imagen (si hay) + texto
async function sendHoursAndMenu(to) {
  if (MENU_IMAGE_URL) {
    await sendImage(to, MENU_IMAGE_URL, `${BUSINESS} – ${CITY}\n📸 Menú y horarios`);
  }
  const lines = [
    "🕐 Horarios:",
    "Jue–Vie 18h00–23h30",
    "Sáb 12h30–23h30",
    "Dom 12h30–19h00",
    "",
    "Si no ves la imagen, responde: *menú* y te la reenvío."
  ];
  await sendText(to, lines.join("\n"));
  await sendMainMenuList(to);
}

// Cerveza
async function sendBeerMenu(to) {
  const txt =
    `🍺 Formatos:\n` +
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
app.get("/", (_req, res) => res.status(200).send("✅ Wayra webhook running."));
app.get("/healthz", (_req, res) => res.sendStatus(200));

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

    // === Bienvenida / inicio ===
    if (s.mode === "idle" && (!s.greeted || /hola|buenas|menu|menú|inicio|start/i.test((text || "").toLowerCase()))) {
      await sendWelcome(from, s);
      return res.sendStatus(200);
    }

    // === Menú principal ===
    if (s.mode === "idle") {
      const low = (text || "").toLowerCase();

      if (text === "reservas" || /^reservar|reserva$/i.test(low)) {
        s.mode = "reserve";
        s.reserve = { date:"", time:"", people:"", name:"" };
        await sendText(from, "¡Perfecto! Vamos a reservar tu mesa.");
        await askReserve(from, "date");
        return res.sendStatus(200);
      }

      if (text === "cerveza" || /cerveza|six|sixpack|barril/i.test(low)) {
        s.mode = "beer";
        s.beer = { kind:"", qty:"", delivery:"" };
        await sendText(from, "¡Vamos con tu pedido de cerveza!");
        await sendBeerMenu(from);
        return res.sendStatus(200);
      }

      if (text === "promos") {
        await sendText(from, "🔥 Promo del fin de semana: 3 pintas por *$10* 🍻");
        await sendMainMenuList(from);
        return res.sendStatus(200);
      }

      if (text === "horario_menu" || /horario|menú|menu/i.test(low)) {
        await sendHoursAndMenu(from);
        return res.sendStatus(200);
      }

      if (text === "ubicacion" || /ubicación|ubicacion|donde/i.test(low)) {
        await sendLocation(from);
        return res.sendStatus(200);
      }

      if (text === "reservas_especiales" || /especial/i.test(low)) {
        s.mode = "special";
        s.special = { occasion:"", date:"", time:"", people:"", name:"", notes:"" };
        await sendText(from, "¡Genial! Te ayudo con tu ocasión especial.");
        await askSpecial(from, "occasion");
        return res.sendStatus(200);
      }

      // Lo que no matchee → re-muestra menú
      await sendMainMenuList(from);
      return res.sendStatus(200);
    }

    // === Flow: RESERVA normal ===
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

    // === Flow: RESERVA especial ===
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

    // === Flow: CERVEZA ===
    if (s.mode === "beer") {
      if (!s.beer.kind) {
        const low = (text || "").toLowerCase();
        if (/six/.test(low)) s.beer.kind = "sixpack";
        else if (/20/.test(low)) s.beer.kind = "barril 20L";
        else if (/30/.test(low)) s.beer.kind = "barril 30L";
        else { await sendText(from, "Formato no válido. Escribe: sixpack / barril 20 / barril 30."); return res.sendStatus(200); }
        await sendText(from, "¿Cuántas unidades deseas?");
        return res.sendStatus(200);
      }
      if (!s.beer.qty)      { s.beer.qty = text; await sendText(from, "¿Entrega o recogida en local?"); return res.sendStatus(200); }
      if (!s.beer.delivery) {
        s.beer.delivery = text;
        const unit = (s.beer.kind.includes("20") ? PRICES.barril_20l :
                      s.beer.kind.includes("30") ? PRICES.barril_30l :
                      PRICES.sixpack);
        const total = (Number(s.beer.qty) * unit).toFixed(2);
        const conf = `✅ Pedido:\n🍺 ${s.beer.kind} x ${s.beer.qty} = $${total}\n🚚 ${s.beer.delivery}\n\n¿Confirmamos? (sí/no)`;
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

    // Fallback → menú
    await sendMainMenuList(from);
    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Error en webhook:", err);
    return res.sendStatus(200);
  }
});

// ====== ARRANQUE ======
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("✅ Bot Wayra corriendo en puerto " + PORT));

// app.js
import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

// --- setup express + static /static for images
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(bodyParser.json());
app.use("/static", express.static(path.join(__dirname, "public")));

// --- env
const CITY            = process.env.CITY || "Ibarra";
const MAP_LINK        = process.env.MAP_LINK || "https://maps.google.com";
const MENU_IMAGE_URL  = process.env.MENU_IMAGE_URL || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN  = process.env.WHATSAPP_TOKEN;
const PLAN_WAYRA_TEXT = process.env.PLAN_WAYRA_TEXT || "";

// --- helpers WhatsApp
const WA_URL = (path) => `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}${path}`;

async function waFetch(path, payload) {
  const r = await fetch(WA_URL(path), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!r.ok) console.error("WA error:", j);
  return j;
}

const sendText = (to, text) =>
  waFetch("/messages", {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  });

const sendImageFromUrl = (to, url, caption = "") =>
  waFetch("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link: url, caption },
  });

// Opciones principales (con “id” para distinguir respuestas)
function sendMainMenu(to) {
  return waFetch("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "🍻 Casa Wayra" },
      body:   { text: "¿Qué te gustaría hacer?" },
      footer: { text: CITY },
      action: {
        button: "Ver opciones",
        sections: [
          {
            title: "Opciones principales",
            rows: [
              { id: "menu_horarios",   title: "🕒 Horarios y ver menú" },
              { id: "reservar",        title: "📅 Reservar mesa" },
              { id: "promos",          title: "🔥 Promos/Eventos" },
              { id: "pedir_cerveza",   title: "🍺 Pedir cerveza" },
              { id: "ubicacion",       title: "📍 Ubicación" },
              ...(PLAN_WAYRA_TEXT ? [{ id: "plan_wayra", title: "💳 Plan Wayra" }] : []),
            ],
          },
        ],
      },
    },
  });
}

// flujo reserva
async function startReservationFlow(to) {
  await sendText(to, "Perfecto, vamos con tu reserva.");
  await sendText(to, "¿Para qué fecha? (ej: 15/10)");
  await sendText(to, "¿A qué hora? (ej: 20:00)");
  await sendText(to, "¿Para cuántas personas?");
}

// flujo promos
async function startPromosFlow(to) {
  await sendText(to, "Esta semana:");
  await sendText(to, "• 3 pintas por $10 (Viernes/Sábado)\n• Música en vivo el sábado 21:00");
}

// flujo pedir cerveza
async function startBeerFlow(to) {
  await sendText(to, "¿Qué deseas pedir?\n• Botellas\n• Barriles\n• Six pack");
}

// flujo menú/horarios: envía imagen del menú y horarios como texto
async function showMenuAndSchedule(to) {
  if (MENU_IMAGE_URL) {
    await sendImageFromUrl(to, MENU_IMAGE_URL, "Menú Casa Wayra");
  } else {
    await sendText(to, "Menú: próximamente. (No se configuró MENU_IMAGE_URL)");
  }
  await sendText(to, `Horarios:\nJue–Vie 18h–23h30\nSáb 12h–23h30\nDom 12h30–19h00`);
}

// flujo ubicación: SOLO LINK (sin lat/lng)
async function sendLocationLink(to) {
  await sendText(to, `📍 Nuestra ubicación:\n${MAP_LINK}`);
}

// plan wayra (opcional)
async function sendPlanWayra(to) {
  if (PLAN_WAYRA_TEXT) {
    await sendText(to, PLAN_WAYRA_TEXT);
  } else {
    await sendText(to, "Plan Wayra no está configurado.");
  }
}

// saludo
async function sendWelcome(to) {
  await sendText(
    to,
    `👋 ¡Hola! Soy el asistente de Wayra Brew Garten en ${CITY}.\nTe ayudo con reservas, promos y pedidos de cerveza.`
  );
  await sendMainMenu(to);
}

// --- Webhook verify (GET)
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "wayra123";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// --- Webhook receive (POST)
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value  = change?.value;

    const to = value?.metadata?.display_phone_number; // informativo
    const msg = value?.messages?.[0];
    const from = msg?.from;

    if (!from) return res.sendStatus(200);

    // Respuestas interactivas (list/button)
    const interactive = msg?.interactive;
    if (interactive?.type === "list_reply") {
      const id = interactive.list_reply.id;

      if (id === "menu_horarios")   await showMenuAndSchedule(from);
      else if (id === "reservar")    await startReservationFlow(from);
      else if (id === "promos")      await startPromosFlow(from);
      else if (id === "pedir_cerveza") await startBeerFlow(from);
      else if (id === "ubicacion")   await sendLocationLink(from);
      else if (id === "plan_wayra")  await sendPlanWayra(from);
      else                           await sendMainMenu(from);

      return res.sendStatus(200);
    }

    // Mensajes de texto: detectar intención sencilla
    const text = msg?.text?.body?.toLowerCase().trim() || "";

    if (["hola", "buenas", "buenos días", "buenas tardes", "menu", "menú"].some(w => text.includes(w))) {
      await sendWelcome(from);
    } else if (text.includes("reserva")) {
      await startReservationFlow(from);
    } else if (text.includes("promo")) {
      await startPromosFlow(from);
    } else if (text.includes("cerveza")) {
      await startBeerFlow(from);
    } else if (text.includes("ubicación") || text.includes("direccion") || text.includes("dirección")) {
      await sendLocationLink(from);
    } else if (text.includes("horario") || text.includes("menú") || text.includes("menu")) {
      await showMenuAndSchedule(from);
    } else if (text.includes("plan wayra")) {
      await sendPlanWayra(from);
    } else {
      // fallback: mostrar menú principal
      await sendMainMenu(from);
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Error en webhook:", e);
    res.sendStatus(200);
  }
});

// ping
app.get("/", (_req, res) => res.send("OK"));

// start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Bot Wayra corriendo en puerto", PORT));

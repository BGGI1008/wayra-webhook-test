// app.js
// Bot WhatsApp Casa Wayra (sin OpenAI)
// Requisitos: "type":"module" en package.json y dependencia "node-fetch"

import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// ---------- Helpers generales ----------
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Textos configurables
const HOURS_TEXT =
  process.env.HOURS_TEXT ||
  "Horarios:\nJue–Vie 18h–23h30\nSáb 12h–23h30\nDom 12h30–19h00";
const PROMOS_TEXT =
  process.env.PROMOS_TEXT || "Esta semana: 🍻 Consulta nuestras promos en barra.";

// Imagen del menú (opcional)
const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || "";

// Ubicación
const MAPS_LAT = Number(process.env.MAPS_LAT || 0);
const MAPS_LNG = Number(process.env.MAPS_LNG || 0);
const MAPS_NAME = process.env.MAPS_NAME || "Casa Wayra";
const MAPS_ADDRESS = process.env.MAPS_ADDRESS || "Ibarra, Ecuador";
const MAPS_URL =
  process.env.MAPS_URL ||
  "https://maps.app.goo.gl/d1RYvkyFchc2yjY89"; // respaldo

// Pequeña memoria en RAM para el flujo de reservas
const sessions = new Map();

// Enviar a WhatsApp (Graph API)
async function sendWhatsApp(payload) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WA_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  console.log("WA resp:", JSON.stringify(data));
  if (!resp.ok) {
    throw new Error("Error enviando a WhatsApp");
  }
  return data;
}

async function sendText(to, body) {
  return sendWhatsApp({
    messaging_product: "whatsapp",
    to,
    text: { body },
  });
}

async function sendImage(to, link, caption = "") {
  return sendWhatsApp({
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link, caption },
  });
}

async function sendLocation(to, { lat, lng, name, address }) {
  return sendWhatsApp({
    messaging_product: "whatsapp",
    to,
    type: "location",
    location: {
      latitude: lat,
      longitude: lng,
      name,
      address,
    },
  });
}

// Menú principal con botones (hasta 3)
async function sendMenu(to, title = "¿Qué te gustaría hacer?") {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: `🍻 Casa Wayra\n${title}\nIbarra` },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "horario_menu", title: "⏰ Horarios y ver menú" },
          },
          {
            type: "reply",
            reply: { id: "ubicacion", title: "📍 Ubicación" },
          },
          {
            type: "reply",
            reply: { id: "promos", title: "🔥 Promos/Eventos" },
          },
        ],
      },
    },
  };
  return sendWhatsApp(payload);
}

// ---------- Flujo de reservas ----------
async function startReserva(to) {
  sessions.set(to, { step: "fecha" });
  await sendText(
    to,
    "Perfecto, vamos con tu reserva.\n📅 ¿Para qué fecha? (ej: 15/10)"
  );
}
async function handleReservaStep(to, text) {
  const s = sessions.get(to) || {};
  if (s.step === "fecha") {
    s.fecha = text.trim();
    s.step = "hora";
    sessions.set(to, s);
    return sendText(to, "⏰ ¿A qué hora? (ej: 20:00)");
  }
  if (s.step === "hora") {
    s.hora = text.trim();
    s.step = "personas";
    sessions.set(to, s);
    return sendText(to, "👥 ¿Para cuántas personas?");
  }
  if (s.step === "personas") {
    s.personas = text.trim();
    s.step = "confirm";
    sessions.set(to, s);
    return sendText(
      to,
      `✨ Resumen:\nFecha: ${s.fecha}\nHora: ${s.hora}\nPersonas: ${s.personas}\n\n¿Confirmas? (sí/no)`
    );
  }
  if (s.step === "confirm") {
    if (/^si|sí|claro|ok|confirmo/i.test(text)) {
      sessions.delete(to);
      await sendText(
        to,
        "✅ ¡Reserva registrada! Te confirmaremos por este medio. ¡Gracias!"
      );
      return sendMenu(to, "¿Algo más?");
    } else {
      sessions.delete(to);
      await sendText(to, "Sin problema, he cancelado la reserva.");
      return sendMenu(to, "¿Qué te gustaría hacer?");
    }
  }
  // Si algo raro pasa, reiniciar
  sessions.delete(to);
  return sendMenu(to, "¿Qué te gustaría hacer?");
}

// ---------- Lógica de intents ----------
async function handleIntent(to, intent) {
  console.log("Intent:", intent);

  if (intent === "horario_menu") {
    // Enviar horarios
    await sendText(to, HOURS_TEXT);
    // Enviar imagen del menú (si existe)
    if (MENU_IMAGE_URL) {
      await sendImage(to, MENU_IMAGE_URL, "Menú Casa Wayra");
    } else {
      await sendText(to, "Nuestro menú está disponible en local 😊");
    }
    return sendMenu(to, "¿Qué te gustaría hacer?");
  }

  if (intent === "ubicacion") {
    // Enviar pin de ubicación + link Google
    await sendLocation(to, {
      lat: MAPS_LAT,
      lng: MAPS_LNG,
      name: MAPS_NAME, // << Casa Wayra
      address: MAPS_ADDRESS,
    });
    await sendText(to, `📍 Nuestra ubicación en Google Maps:\n${MAPS_URL}`);
    return sendMenu(to, "¿Qué te gustaría hacer?");
  }

  if (intent === "promos") {
    await sendText(to, `🔥 ${PROMOS_TEXT}`);
    return sendMenu(to, "¿Qué te gustaría hacer?");
  }

  if (intent === "reserva") {
    return startReserva(to);
  }

  // Default → menú
  return sendMenu(to, "¿Qué te gustaría hacer?");
}

// Detectar intent desde texto simple
function intentFromText(t = "") {
  const text = t.toLowerCase();
  if (/reserva|reservar|mesa/.test(text)) return "reserva";
  if (/promo|evento/.test(text)) return "promos";
  if (/ubicaci|llegar|direcci/.test(text)) return "ubicacion";
  if (/horario|men[uú]|carta/.test(text)) return "horario_menu";
  return null;
}

// ---------- Webhook verify (GET) ----------
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "wayra123";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Verificación de Meta completada");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---------- Webhook receiver (POST) ----------
app.post("/webhook", async (req, res) => {
  try {
    // Mensajes entrantes de WhatsApp
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    // Ignorar callbacks de estado, etc.
    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from; // número del usuario
    console.log(
      "Entrante:",
      "type",
      message.type,
      "| mode:",
      sessions.get(from)?.step || "idle"
    );

    // 1) Respuestas de botones ("interactive")
    if (message.type === "interactive") {
      const buttonId = message?.interactive?.button_reply?.id;
      if (buttonId) {
        await handleIntent(from, buttonId);
        return res.sendStatus(200);
      }
    }

    // 2) Texto libre (puede ser parte de una reserva en curso)
    if (message.type === "text") {
      const text = message.text.body.trim();

      // Si está en medio de una reserva, seguir el flujo
      if (sessions.has(from)) {
        await handleReservaStep(from, text);
        return res.sendStatus(200);
      }

      // Saludo / bienvenida
      if (/^hola|buenas|saludos/i.test(text)) {
        await sendText(
          from,
          "👋 ¡Hola! Soy el asistente de *Casa Wayra* en Ibarra.\nTe ayudo con *reservas*, *promos* y *pedidos de cerveza*."
        );
        await sendMenu(from, "¿Qué te gustaría hacer?");
        return res.sendStatus(200);
      }

      // Intent por palabras
      const intent = intentFromText(text);
      if (intent) {
        await handleIntent(from, intent);
        return res.sendStatus(200);
      }

      // Si no entiende, mostrar menú
      await sendText(
        from,
        "No te entendí bien 😅. Elige una opción del menú o escribe:\n- *Reservar mesa*\n- *Horarios*\n- *Ubicación*\n- *Promos*"
      );
      await sendMenu(from, "¿Qué te gustaría hacer?");
      return res.sendStatus(200);
    }

    // Otros tipos no manejados → devolver menú
    await sendMenu(from, "¿Qué te gustaría hacer?");
    return res.sendStatus(200);
  } catch (err) {
    console.error("Error en webhook:", err);
    return res.sendStatus(200);
  }
});

// Salud para evitar "Cannot GET /"
app.get("/", (_req, res) => res.status(200).send("OK - Casa Wayra bot activo"));

// Puerto (Render lo inyecta)
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`🚀 Bot Wayra corriendo en puerto ${PORT}`)
);

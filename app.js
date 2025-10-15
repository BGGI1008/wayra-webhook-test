// app.js — Wayra WhatsApp bot (sin OpenAI)
// Node 18+ (fetch nativo)

import express from "express";

// ===================== ENV =====================
const {
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  CITY = "Ibarra",
  MENU_IMAGE_URL = "",
  MAPS_URL = "",
  MAPS_LAT = "",
  MAPS_LNG = "",
  MAPS_NAME = "Casa Wayra",
  MAPS_ADDRESS = "Ibarra - Ecuador",
  HOURS_TEXT = "Jue–Vie 18h–23h30\nSáb 12h–23h30\nDom 12h30–19h00",
  PLAN_WAYRA_TEXT = "PLAN WAYRA: todo a $2.\nJue–Vie 18h–23h30, Sáb 12h–23h30, Dom 12h30–19h00",
  VERIFY_TOKEN = "wayra123",
  PORT = 10000,
} = process.env;

// Validación rápida
if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.error("❌ Falta WHATSAPP_TOKEN o PHONE_NUMBER_ID en variables de entorno.");
}

// ===================== APP =====================
const app = express();
app.use(express.json());

// ===================== HELPERS WA =====================
const WA_URL = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;

async function sendWA(payload) {
  const resp = await fetch(WA_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("WA resp ERROR:", JSON.stringify(data));
  } else {
    console.log("WA resp:", JSON.stringify(data));
  }
  return data;
}

const sendText = (to, body) =>
  sendWA({ messaging_product: "whatsapp", to, text: { body } });

const sendImage = (to, link, caption = "") =>
  sendWA({ messaging_product: "whatsapp", to, type: "image", image: { link, caption } });

const sendLocation = (to, { lat, lng, name = MAPS_NAME, address = MAPS_ADDRESS }) =>
  sendWA({
    messaging_product: "whatsapp",
    to,
    type: "location",
    location: { latitude: lat, longitude: lng, name, address },
  });

// ===== Menú LISTA (principal)
function mainListPayload(to, prompt = "¿Qué te gustaría hacer?") {
  return {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Casa Wayra" },
      body: { text: prompt },
      footer: { text: "Selecciona una opción 👇" },
      action: {
        button: "Ver opciones",
        sections: [
          {
            title: "Opciones",
            rows: [
              { id: "horario_menu",  title: "Horarios y menú" },
              { id: "ubicacion",     title: "Ubicación" },
              { id: "promos",        title: "Promos/Eventos" },
              { id: "plan_wayra",    title: "Plan Wayra" },
              { id: "pedir_cerveza", title: "Pedir cerveza" },
              { id: "reservar_mesa", title: "Reservar mesa" },
            ],
          },
        ],
      },
    },
  };
}
const sendMainList = (to, prompt) => sendWA(mainListPayload(to, prompt));

// ===================== RESERVAS (memoria) =====================
const reservas = new Map(); // phone => { step, date, time, people }

function startReservaSession(phone) {
  reservas.set(phone, { step: "date", date: null, time: null, people: null });
}
function endReservaSession(phone) {
  reservas.delete(phone);
}

// ===================== WEBHOOKS =====================

// Verificación de webhook (Meta)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Verificación de Meta completada");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepción de mensajes
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const msg = value?.messages?.[0];
    const from = msg?.from;

    if (!from || !msg) {
      return res.sendStatus(200);
    }

    console.log("==> Entrante:", JSON.stringify(msg));

    // 1) Respuestas de LISTA
    const interactive = msg?.interactive;
    if (interactive?.type === "list_reply") {
      const id = interactive.list_reply.id;

      if (id === "horario_menu") {
        await sendText(from, `Horarios:\n${HOURS_TEXT}`);
        if (MENU_IMAGE_URL) {
          await sendImage(from, MENU_IMAGE_URL, "Menú Casa Wayra");
        }
        await sendMainList(from, "¿Qué más te gustaría hacer?");
        return res.sendStatus(200);
      }

      if (id === "ubicacion") {
        if (MAPS_LAT && MAPS_LNG) {
          await sendLocation(from, { lat: MAPS_LAT, lng: MAPS_LNG });
        }
        if (MAPS_URL) {
          await sendText(from, `Nuestra ubicación:\n${MAPS_URL}`);
        }
        await sendMainList(from, "¿Qué más te gustaría hacer?");
        return res.sendStatus(200);
      }

      if (id === "promos") {
        await sendText(
          from,
          "Esta semana:\n• 3 pintas por $10\n• Alitas + pinta $7.50\n• Pregunta por nuestras ediciones especiales"
        );
        await sendMainList(from, "¿Qué más te gustaría hacer?");
        return res.sendStatus(200);
      }

      if (id === "plan_wayra") {
        await sendText(from, PLAN_WAYRA_TEXT);
        await sendMainList(from, "¿Qué más te gustaría hacer?");
        return res.sendStatus(200);
      }

      if (id === "pedir_cerveza") {
        await sendText(
          from,
          "Pedir cerveza:\n• Barril 20L/30L\n• Sixpack\n• Growlers\nResponde con lo que quieres y un número de contacto."
        );
        await sendMainList(from, "¿Qué más te gustaría hacer?");
        return res.sendStatus(200);
      }

      if (id === "reservar_mesa") {
        startReservaSession(from);
        await sendText(from, "Perfecto, vamos con tu reserva.\n¿Para qué fecha? (ej: 15/10)");
        return res.sendStatus(200);
      }

      await sendText(from, "Opción no válida.");
      await sendMainList(from, "Elige una opción:");
      return res.sendStatus(200);
    }

    // 2) Flujo de RESERVA por texto (simple)
    const r = reservas.get(from);
    if (r) {
      const body = (msg.text?.body || "").trim();
      if (r.step === "date") {
        r.date = body;
        r.step = "time";
        await sendText(from, "¿A qué hora? (ej: 20:00)");
        return res.sendStatus(200);
      }
      if (r.step === "time") {
        r.time = body;
        r.step = "people";
        await sendText(from, "¿Para cuántas personas?");
        return res.sendStatus(200);
      }
      if (r.step === "people") {
        r.people = body;
        await sendText(
          from,
          `✅ Reserva registrada:\nFecha: ${r.date}\nHora: ${r.time}\nPersonas: ${r.people}\n\nTe contactaremos para confirmar.`
        );
        endReservaSession(from);
        await sendMainList(from, "¿Qué más te gustaría hacer?");
        return res.sendStatus(200);
      }
    }

    // 3) Texto libre -> detectar intención básica
    const text = (msg.text?.body || "").toLowerCase();

    // saludos -> bienvenida + lista
    if (/(hola|buenas|buenos días|buenas tardes|buenas noches)/i.test(text)) {
      await sendText(
        from,
        `¡Hola! Soy el asistente de Wayra Brew Garten en ${CITY}. Te ayudo con reservas, promos y pedidos de cerveza.`
      );
      await sendMainList(from, "Bienvenido a Casa Wayra\n¿Qué te gustaría hacer?");
      return res.sendStatus(200);
    }

    // atajos por texto
    if (/(horario|menú|menu)/i.test(text)) {
      await sendText(from, `Horarios:\n${HOURS_TEXT}`);
      if (MENU_IMAGE_URL) {
        await sendImage(from, MENU_IMAGE_URL, "Menú Casa Wayra");
      }
      await sendMainList(from, "¿Qué más te gustaría hacer?");
      return res.sendStatus(200);
    }

    if (/ubicaci(ón|on)|dónde están|donde estan/i.test(text)) {
      if (MAPS_LAT && MAPS_LNG) {
        await sendLocation(from, { lat: MAPS_LAT, lng: MAPS_LNG });
      }
      if (MAPS_URL) {
        await sendText(from, `Nuestra ubicación:\n${MAPS_URL}`);
      }
      await sendMainList(from, "¿Qué más te gustaría hacer?");
      return res.sendStatus(200);
    }

    if (/promo|promos|evento|eventos/i.test(text)) {
      await sendText(
        from,
        "Esta semana:\n• 3 pintas por $10\n• Alitas + pinta $7.50\n• Pregunta por nuestras ediciones especiales"
      );
      await sendMainList(from, "¿Qué más te gustaría hacer?");
      return res.sendStatus(200);
    }

    if (/plan/i.test(text)) {
      await sendText(from, PLAN_WAYRA_TEXT);
      await sendMainList(from, "¿Qué más te gustaría hacer?");
      return res.sendStatus(200);
    }

    if (/cerveza|comprar|six|barril|growler/i.test(text)) {
      await sendText(
        from,
        "Pedir cerveza:\n• Barril 20L/30L\n• Sixpack\n• Growlers\nResponde con lo que quieres y un número de contacto."
      );
      await sendMainList(from, "¿Qué más te gustaría hacer?");
      return res.sendStatus(200);
    }

    if (/reserv/i.test(text)) {
      startReservaSession(from);
      await sendText(from, "Perfecto, vamos con tu reserva.\n¿Para qué fecha? (ej: 15/10)");
      return res.sendStatus(200);
    }

    // fallback
    await sendText(from, "No te entendí bien. Elige una opción del menú:");
    await sendMainList(from, "¿Qué te gustaría hacer?");
    return res.sendStatus(200);
  } catch (err) {
    console.error("Error en webhook:", err);
    return res.sendStatus(200);
  }
});

// ===================== ROOT =====================
app.get("/", (_, res) => res.send("Bot Wayra activo."));

// ===================== START =====================
app.listen(PORT, () =>
  console.log(`✅ Bot Wayra corriendo en puerto ${PORT}`)
);

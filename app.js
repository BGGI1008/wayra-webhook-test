// ==============================
//  Casa Wayra – WhatsApp Bot
//  (Sin OpenAI, con menús y flujos)
// ==============================

import express from "express";
import bodyParser from "body-parser";

// ----- Config (desde variables de entorno)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "wayra123"; // Debe coincidir con lo puesto en Meta
const WABA_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || "";
const MAPS_LAT = Number(process.env.MAPS_LAT || "0");
const MAPS_LNG = Number(process.env.MAPS_LNG || "0");
const MAPS_NAME = process.env.MAPS_NAME || "Wayra Brew Garten";
const MAPS_ADDRESS = process.env.MAPS_ADDRESS || "Ibarra, Ecuador";
const MAPS_URL = process.env.MAPS_URL || "";

const HOURS_TEXT =
  process.env.HOURS_TEXT ||
  "Jue–Vie 18h–23h30\nSáb 12h–23h30\nDom 12h30–19h00";

const PLAN_WAYRA_TEXT =
  process.env.PLAN_WAYRA_TEXT ||
  "PLAN WAYRA: todo a $2. Jue–Vie 18h–23h30, Sáb 12h–23h30, Dom 12h30–19h00";

const CITY = process.env.CITY || "Ibarra";

// ----- App
const app = express();
app.use(bodyParser.json());

// Sesi&oacute;n muy simple en memoria para flujo de reserva
const sessions = {}; // { from: { step: 'reserva_fecha'|'reserva_hora'|'reserva_personas', reserva: {fecha, hora, personas}} }

// Utilidades
const WA_BASE = `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`;

async function sendWhatsApp(payload) {
  const resp = await fetch(WA_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WABA_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  console.log("WA resp:", JSON.stringify(data));
  return data;
}

async function sendText(to, text) {
  return sendWhatsApp({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
}

async function sendImage(to, url, caption = "") {
  return sendWhatsApp({
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link: url, caption },
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

// Menú principal (3 botones, ≤ 20 chars)
async function sendMainMenu(to, prompt = "¿Qué te gustaría hacer?") {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: prompt },
      action: {
        buttons: [
          { type: "reply", reply: { id: "horario_menu", title: "Horarios y menú" } },
          { type: "reply", reply: { id: "ubicacion", title: "Ubicación" } },
          { type: "reply", reply: { id: "promos", title: "Promos/Eventos" } },
        ],
      },
    },
  };
  return sendWhatsApp(payload);
}

// Menú extra (3 botones más)
async function sendExtraMenu(to) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Más opciones:" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "plan_wayra", title: "Plan Wayra" } },
          { type: "reply", reply: { id: "pedir_cerveza", title: "Pedir cerveza" } },
          { type: "reply", reply: { id: "reservar_mesa", title: "Reservar mesa" } },
        ],
      },
    },
  };
  return sendWhatsApp(payload);
}

// Saludo + presentación + menú
async function sendWelcome(to) {
  await sendText(
    to,
    `Hola, soy el asistente de Wayra Brew Garten en ${CITY}. Te ayudo con reservas, promos y pedidos de cerveza.`
  );
  await sendMainMenu(to, "Bienvenido a Casa Wayra\n¿Qué te gustaría hacer?");
}

// Acciones de negocio
async function handleHorarioMenu(to) {
  await sendText(to, `Horarios:\n${HOURS_TEXT}`);
  if (MENU_IMAGE_URL) {
    await sendImage(to, MENU_IMAGE_URL, "Menú Casa Wayra");
  }
  await sendExtraMenu(to);
}

async function handleUbicacion(to) {
  // Enviar pin
  if (!isNaN(MAPS_LAT) && !isNaN(MAPS_LNG) && MAPS_LAT !== 0 && MAPS_LNG !== 0) {
    await sendLocation(to, {
      lat: MAPS_LAT,
      lng: MAPS_LNG,
      name: MAPS_NAME,
      address: MAPS_ADDRESS,
    });
  }
  // Enviar link
  if (MAPS_URL) {
    await sendText(to, `Nuestra ubicación:\n${MAPS_URL}`);
  }
  await sendMainMenu(to);
}

async function handlePromos(to) {
  await sendText(
    to,
    "Esta semana:\n• 3 pintas por $10\n• Alitas + pinta $7.50\n• Pregunta por nuestras ediciones especiales"
  );
  await sendExtraMenu(to);
}

async function handlePlanWayra(to) {
  await sendText(to, PLAN_WAYRA_TEXT);
  await sendMainMenu(to);
}

async function handlePedirCerveza(to) {
  await sendText(
    to,
    "Pedir cerveza:\n• Barril 20L / 30L\n• Sixpack\n• Growlers\nResponde con lo que quieres y un número de contacto."
  );
  await sendMainMenu(to);
}

// Flujo simple de reserva
function startReservaSession(from) {
  sessions[from] = { step: "reserva_fecha", reserva: {} };
}
async function handleReservarMesa(to, from) {
  startReservaSession(from);
  await sendText(to, "Perfecto, vamos con tu reserva.\n¿Para qué fecha? (ej: 15/10)");
}

async function continueReserva(to, from, userText) {
  const s = sessions[from];
  if (!s) return;

  if (s.step === "reserva_fecha") {
    s.reserva.fecha = userText.trim();
    s.step = "reserva_hora";
    await sendText(to, "¿A qué hora? (ej: 20:00)");
    return;
  }
  if (s.step === "reserva_hora") {
    s.reserva.hora = userText.trim();
    s.step = "reserva_personas";
    await sendText(to, "¿Para cuántas personas?");
    return;
  }
  if (s.step === "reserva_personas") {
    s.reserva.personas = userText.trim();
    await sendText(
      to,
      `Reserva registrada:\nFecha: ${s.reserva.fecha}\nHora: ${s.reserva.hora}\nPersonas: ${s.reserva.personas}\n\nTe confirmaremos por este medio.`
    );
    delete sessions[from];
    await sendMainMenu(to);
    return;
  }
}

// Normalizar intent desde texto libre
function detectIntentFromText(t) {
  const txt = (t || "").toLowerCase();
  if (txt.includes("horario") || txt.includes("menú") || txt.includes("menu")) return "horario_menu";
  if (txt.includes("ubicación") || txt.includes("ubicacion") || txt.includes("direccion") || txt.includes("dirección")) return "ubicacion";
  if (txt.includes("promo") || txt.includes("evento")) return "promos";
  if (txt.includes("plan")) return "plan_wayra";
  if (txt.includes("cerveza") || txt.includes("six") || txt.includes("barril")) return "pedir_cerveza";
  if (txt.includes("reserva") || txt.includes("reservar")) return "reservar_mesa";
  if (txt.includes("hola") || txt.includes("buenos")) return "saludo";
  return "desconocido";
}

// =====================
//  Rutas
// =====================

// raíz (para healthcheck)
app.get("/", (_req, res) => res.status(200).send("OK"));

// Verificación del webhook (Meta)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepción de mensajes
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Botón o lista
    const interactive = value?.messages?.[0]?.interactive;
    const msg = value?.messages?.[0];
    const from = value?.messages?.[0]?.from; // número remitente

    if (!from) return res.sendStatus(200);

    // 1) Mensajes interactivos (botones/list)
    if (interactive?.type === "button_reply") {
      const id = interactive.button_reply.id;
      if (id === "horario_menu") { await handleHorarioMenu(from); return res.sendStatus(200); }
      if (id === "ubicacion")    { await handleUbicacion(from);   return res.sendStatus(200); }
      if (id === "promos")       { await handlePromos(from);      return res.sendStatus(200); }
      if (id === "plan_wayra")   { await handlePlanWayra(from);   return res.sendStatus(200); }
      if (id === "pedir_cerveza"){ await handlePedirCerveza(from);return res.sendStatus(200); }
      if (id === "reservar_mesa"){ await handleReservarMesa(from, from); return res.sendStatus(200); }

      await sendText(from, "No entendí la opción. Elige de nuevo:");
      await sendMainMenu(from);
      return res.sendStatus(200);
    }

    if (interactive?.type === "list_reply") {
      const id = interactive.list_reply.id;
      // (mismo manejo que arriba si usas listas)
      // ...
      return res.sendStatus(200);
    }

    // 2) Mensaje de texto
    const text = msg?.text?.body;
    if (text) {
      // Si está en flujo de reserva, priorizamos continuar
      if (sessions[from]?.step) {
        await continueReserva(from, from, text);
        return res.sendStatus(200);
      }

      const intent = detectIntentFromText(text);
      console.log("Entrante: text", text, "| intent:", intent);

      switch (intent) {
        case "saludo":
          await sendWelcome(from);
          break;
        case "horario_menu":
          await handleHorarioMenu(from);
          break;
        case "ubicacion":
          await handleUbicacion(from);
          break;
        case "promos":
          await handlePromos(from);
          break;
        case "plan_wayra":
          await handlePlanWayra(from);
          break;
        case "pedir_cerveza":
          await handlePedirCerveza(from);
          break;
        case "reservar_mesa":
          await handleReservarMesa(from, from);
          break;
        default:
          await sendText(
            from,
            "Puedo ayudarte con:\n• Horarios y menú\n• Ubicación\n• Promos/Eventos\n• Plan Wayra\n• Pedir cerveza\n• Reservar mesa"
          );
          await sendMainMenu(from);
          break;
      }

      return res.sendStatus(200);
    }

    // 3) Otros tipos (notificaciones de status, etc.)
    return res.sendStatus(200);
  } catch (err) {
    console.error("Error en webhook:", err);
    return res.sendStatus(200);
  }
});

// Puerto
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Bot Wayra corriendo en puerto ${PORT}`));

// app.js — Wayra WhatsApp bot (imagen de menú + texto + lista simple)
// Node 18+ (fetch nativo)

import express from "express";

const {
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  CITY = "Ibarra",
  MAPS_URL = "",                                // p.ej. https://maps.app.goo.gl/XXXX
  MAPS_LAT = "",                                // opcional
  MAPS_LNG = "",                                // opcional
  MAPS_NAME = "Casa Wayra",
  MAPS_ADDRESS = "Ibarra - Ecuador",
  HOURS_TEXT = "Jue–Vie 18h–23h30\nSáb 12h–23h30\nDom 12h30–19h00",
  PLAN_WAYRA_TEXT = "PLAN WAYRA: todo a $2.\nJue–Vie 18h–23h30, Sáb 12h–23h30, Dom 12h30–19h00",
  MENU_IMAGE_URL = "",                           // <-- pon aquí https://wayra-webhook-test.onrender.com/static/menu.jpg
  VERIFY_TOKEN = "wayra123",
  PORT = 10000,
} = process.env;

if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.error("❌ Falta WHATSAPP_TOKEN o PHONE_NUMBER_ID en variables de entorno.");
}

const MENU_TEXT = `
🍻 *MENÚ CASA WAYRA*

*Para picar*
• Nachos — 2p $5 / 4p $8
• Papas Cheddar — 2p $5 / 4p $8
• Picada Mar & Tierra — 2p $8 / 4p $12
• Alitas (BBQ/Maracuyá/Teriyaki/Miel-Mostaza/Picante/Limón) — 8u $7.50 / 12u + 3 salsas $11.50
• Choripapa $3.99
• Nuggets de pollo $3.99

*Ensaladas*
• Mariscos $5.99
• César $4.99

*Bebidas de la Casa* (Vaso 350ml / Pinta 500ml / Jarra 1.3L)
• Chicha Wayra $3 / $3.50 / $6.50
• Honey Ale $3.50 / $4.50 / $10
• Barley Wine $3.50 / $4.50 / $10
• Stout $3.50 / $4.50 / $10
• Edición Especial $3.50 / $4.50 / $10

*Platos fuertes*
• Hamburguesa Campestre 1/4 lb $5
• Hamburguesa Wayra $7.50
• Picaña de res $9.99
• Costilla de cerdo al grill $8.99
• Pollo al grill $6.50
• Chuleta de cerdo al grill $7.50
• Borrego al grill $9.99
• Brocheta de camarón $5
• Brocheta mixta $6

*Guarniciones*
• Papas fritas
• Papas chauchas salteadas

*Postres*
• Del día $2.99

*Promo fin de semana*
• 3 pintas por $10 (consulta estilos)

Escribe *reservar*, *pedir cerveza*, *promos* o *ubicación*, o usa *Ver opciones*.
`.trim();

const app = express();
app.use(express.json());

// sirve /public como /static  (para menu.jpg)
app.use("/static", express.static("public"));

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
  if (!resp.ok) console.error("WA resp ERROR:", JSON.stringify(data));
  else console.log("WA resp:", JSON.stringify(data));
  return data;
}

const sendText = (to, body) =>
  sendWA({ messaging_product: "whatsapp", to, text: { body } });

const sendLocation = (to, { lat, lng, name = MAPS_NAME, address = MAPS_ADDRESS }) =>
  sendWA({ messaging_product: "whatsapp", to, type: "location",
           location: { latitude: lat, longitude: lng, name, address } });

const sendImage = (to, link, caption = "") =>
  sendWA({ messaging_product: "whatsapp", to, type: "image", image: { link, caption } });

async function sendLongText(to, text, chunkSize = 900) {
  for (let i = 0; i < text.length; i += chunkSize) {
    await sendText(to, text.slice(i, i + chunkSize));
  }
}

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

// reservas simples
const reservas = new Map();
const startReservaSession = (phone) =>
  reservas.set(phone, { step: "date", date: null, time: null, people: null });
const endReservaSession = (phone) => reservas.delete(phone);

// webhook verify
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// webhook inbound
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    const from = msg?.from;
    if (!from || !msg) return res.sendStatus(200);

    // respuesta desde LISTA
    const interactive = msg?.interactive;
    if (interactive?.type === "list_reply") {
      const id = interactive.list_reply.id;

      if (id === "horario_menu") {
        await sendText(from, `*Horarios:*\n${HOURS_TEXT}`);
        if (MENU_IMAGE_URL) await sendImage(from, MENU_IMAGE_URL, "Menú Casa Wayra");
        await sendLongText(from, MENU_TEXT);
        await sendMainList(from, "¿Qué más te gustaría hacer?");
        return res.sendStatus(200);
      }

      if (id === "ubicacion") {
        if (MAPS_LAT && MAPS_LNG) await sendLocation(from, { lat: MAPS_LAT, lng: MAPS_LNG });
        if (MAPS_URL) await sendText(from, `Nuestra ubicación:\n${MAPS_URL}`);
        await sendMainList(from, "¿Qué más te gustaría hacer?");
        return res.sendStatus(200);
      }

      if (id === "promos") {
        await sendText(from, "Esta semana:\n• 3 pintas por $10 (Viernes/Sábado)\n• Música en vivo el sábado 21:00");
        await sendMainList(from, "¿Qué más te gustaría hacer?");
        return res.sendStatus(200);
      }

      if (id === "plan_wayra") {
        await sendText(from, PLAN_WAYRA_TEXT);
        await sendMainList(from, "¿Qué más te gustaría hacer?");
        return res.sendStatus(200);
      }

      if (id === "pedir_cerveza") {
        await sendText(from, "Pedir cerveza:\n• Barril 20L/30L\n• Sixpack\n• Growlers\nResponde con lo que quieres y un número de contacto.");
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

    // flujo reserva
    const r = reservas.get(from);
    if (r) {
      const body = (msg.text?.body || "").trim();
      if (r.step === "date") {
        r.date = body; r.step = "time";
        await sendText(from, "¿A qué hora? (ej: 20:00)");
        return res.sendStatus(200);
      }
      if (r.step === "time") {
        r.time = body; r.step = "people";
        await sendText(from, "¿Para cuántas personas?");
        return res.sendStatus(200);
      }
      if (r.step === "people") {
        r.people = body;
        await sendText(from, `✅ Reserva registrada:\nFecha: ${r.date}\nHora: ${r.time}\nPersonas: ${r.people}\n\nTe contactaremos para confirmar.`);
        endReservaSession(from);
        await sendMainList(from, "¿Qué más te gustaría hacer?");
        return res.sendStatus(200);
      }
    }

    // atajos por texto
    const text = (msg.text?.body || "").toLowerCase();

    if (/(hola|buenas|buenos días|buenas tardes|buenas noches)/i.test(text)) {
      await sendText(from, `¡Hola! Soy el asistente de Wayra Brew Garten en ${CITY}. Te ayudo con reservas, promos y pedidos de cerveza.`);
      await sendMainList(from, "Bienvenido a Casa Wayra\n¿Qué te gustaría hacer?");
      return res.sendStatus(200);
    }

    if (/(horario|menú|menu)/i.test(text)) {
      await sendText(from, `*Horarios:*\n${HOURS_TEXT}`);
      if (MENU_IMAGE_URL) await sendImage(from, MENU_IMAGE_URL, "Menú Casa Wayra");
      await sendLongText(from, MENU_TEXT);
      await sendMainList(from, "¿Qué más te gustaría hacer?");
      return res.sendStatus(200);
    }

    if (/ubicaci(ón|on)|dónde están|donde estan/i.test(text)) {
      if (MAPS_LAT && MAPS_LNG) await sendLocation(from, { lat: MAPS_LAT, lng: MAPS_LNG });
      if (MAPS_URL) await sendText(from, `Nuestra ubicación:\n${MAPS_URL}`);
      await sendMainList(from, "¿Qué más te gustaría hacer?");
      return res.sendStatus(200);
    }

    if (/promo|promos|evento|eventos/i.test(text)) {
      await sendText(from, "Esta semana:\n• 3 pintas por $10 (Viernes/Sábado)\n• Música en vivo el sábado 21:00");
      await sendMainList(from, "¿Qué más te gustaría hacer?");
      return res.sendStatus(200);
    }

    if (/plan/i.test(text)) {
      await sendText(from, PLAN_WAYRA_TEXT);
      await sendMainList(from, "¿Qué más te gustaría hacer?");
      return res.sendStatus(200);
    }

    if (/cerveza|comprar|six|barril|growler/i.test(text)) {
      await sendText(from, "Pedir cerveza:\n• Barril 20L/30L\n• Sixpack\n• Growlers\nResponde con lo que quieres y un número de contacto.");
      await sendMainList(from, "¿Qué más te gustaría hacer?");
      return res.sendStatus(200);
    }

    if (/reserv/i.test(text)) {
      startReservaSession(from);
      await sendText(from, "Perfecto, vamos con tu reserva.\n¿Para qué fecha? (ej: 15/10)");
      return res.sendStatus(200);
    }

    await sendText(from, "No te entendí bien. Elige una opción del menú:");
    await sendMainList(from, "¿Qué te gustaría hacer?");
    return res.sendStatus(200);
  } catch (err) {
    console.error("Error en webhook:", err);
    return res.sendStatus(200);
  }
});

app.get("/", (_, res) => res.send("Bot Wayra activo."));
app.listen(PORT, () => console.log(`✅ Bot Wayra corriendo en puerto ${PORT}`));

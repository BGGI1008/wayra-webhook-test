const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

// Verificación del webhook (la URL /webhook de Meta)
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "wayra123"; // el mismo que pusiste en Meta
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && token === VERIFY_TOKEN) {
    console.log("✅ Verificación de Meta completada");
    return res.status(200).send(challenge);
  }
  console.log("❌ Falló la verificación");
  return res.sendStatus(403);
});

// Bot con ChatGPT + respuesta por WhatsApp
app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 Payload:", JSON.stringify(req.body, null, 2));

    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200); // otros eventos (entrega/lectura/etc.)

    const from = msg.from;
    const userText = msg.text?.body || "";

    const systemPrompt = `
Eres el asistente oficial de ${process.env.BUSINESS_NAME || "Casa Wayra"} en ${process.env.CITY || "Ibarra"}.
Ayuda a reservar mesa (fecha/hora/personas/nombre), ver promociones/eventos y pedir cerveza (barril/sixpack). 
Tono cálido y claro. Máx. 320 caracteres. Termina con una pregunta concreta.
`.trim();

    // 1) Llama a OpenAI
    let replyText =
      "¡Hola! 🍻 Gracias por escribir a Casa Wayra. ¿Reservar, promos o cerveza?";

    try {
      const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.4,
          max_tokens: 200,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userText || "Cliente envió un mensaje." },
          ],
        }),
      });

      if (aiResp.ok) {
        const data = await aiResp.json();
        replyText =
          data.choices?.[0]?.message?.content?.slice(0, 500) || replyText;
      } else {
        console.error("❌ OpenAI error:", await aiResp.text());
      }
    } catch (e) {
      console.error("❌ OpenAI exception:", e);
    }

    // 2) Envía respuesta por WhatsApp
    const waUrl = `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: from,
      type: "text",
      text: { body: replyText },
    };

    const waResp = await fetch(waUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    console.log("✅ Respuesta enviada a WhatsApp:", await waResp.text());
    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error en webhook:", err);
    return res.sendStatus(200); // evita reintentos de Meta
  }
});

app.listen(10000, () => console.log("✅ Servidor corriendo en puerto 10000"));

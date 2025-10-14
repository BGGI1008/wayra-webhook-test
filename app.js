import express from "express";

const app = express();
app.use(express.json());

// ✅ Ruta principal: muestra que el webhook está activo
app.get("/", (req, res) => {
  res.send("✅ Webhook de Casa Wayra funcionando correctamente");
});

// ✅ Ruta para verificación de Meta (setup del webhook)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === "wayra123") {
    console.log("✅ Verificación de Meta completada");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Falló la verificación");
    res.sendStatus(403);
  }
});

// ✅ Ruta para recibir mensajes de WhatsApp
app.post("/webhook", (req, res) => {
  console.log("📩 Nuevo mensaje recibido:");
  console.log(JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// ✅ Puerto (Render lo usa automáticamente)
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Servidor corriendo en puerto " + PORT));

import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

app.get("/webhook", (req, res) => {
  const verify_token = "wayra123"; // mismo token que usaste en Meta
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === verify_token) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const message = changes?.value?.messages?.[0];
  
  if (message && message.text) {
    const text = message.text.body;
    const from = message.from;

    // 🔹 Enviar mensaje a OpenAI
    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "Eres un asistente de Casa Wayra que responde con amabilidad y precisión." },
          { role: "user", content: text },
        ],
      }),
    }).then((r) => r.json());

    const reply = gptResponse.choices?.[0]?.message?.content || "No entendí tu mensaje.";

    // 🔹 Enviar respuesta a WhatsApp
    await fetch("https://graph.facebook.com/v17.0/850689061455817/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer EAHJQEt3FEcOBPt0cZCOZChgld7hqZBZC9bzRyN3XlZBHgmZBgNuZBdfJZAfLGVsjlDfg07mfl9Xi3",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      }),
    });
  }

  res.sendStatus(200);
});

app.listen(10000, () => console.log("✅ Servidor corriendo en puerto 10000"));

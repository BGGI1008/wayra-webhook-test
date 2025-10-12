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
app.listen(10000, () => console.log("Servidor corriendo en puerto 10000"));

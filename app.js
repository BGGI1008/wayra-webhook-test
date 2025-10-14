app.post("/webhook", async (req, res) => {
  try {
    console.log("📥 RAW BODY:", JSON.stringify(req.body, null, 2));
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const to = msg.from;

    // Enviar texto simple
    const url = `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: "OK recibido ✅" }
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    console.log("WA minimal resp:", await r.text());
    return res.sendStatus(200);
  } catch (e) {
    console.error("❌ Error handler minimal:", e);
    return res.sendStatus(200);
  }
});

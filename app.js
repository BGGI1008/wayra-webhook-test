app.post("/webhook", async (req, res) => {
  try {
    const change = req.body?.entry?.[0]?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const txt = extractUserText(msg);
    const s = getSession(from);
    console.log("▶️ Entrante:", msg.type, txt, "| mode:", s.mode);

    // ====== Intents por botones o palabras clave cuando está "idle" ======
    if (s.mode === "idle") {
      const low = (txt || "").toLowerCase();

      if (["reservar", "reserva", "res"].includes(low)) {
        s.mode = "reserve";
        s.reserve = { date: "", time: "", people: "", name: "" };
        await sendText(from, "Perfecto, vamos a reservar tu mesa.");
        await sendReserveAsk(from, "date");
        return res.sendStatus(200);
      }

      if (["promos", "promociones", "eventos"].includes(low)) {
        await sendText(from, "Nuestras promos y eventos:");
        await sendText(from, PROMOS.join("\n"));
        await sendMainMenu(from);
        return res.sendStatus(200);
      }

      if (["cerveza", "six", "sixpack", "barril"].includes(low)) {
        s.mode = "beer";
        s.beer = { kind: "", qty: "", delivery: "" };
        await sendText(from, "¡Vamos con tu pedido de cerveza!");
        await sendBeerMenu(from);
        return res.sendStatus(200);
      }

      // si llega “hola” o algo sin intención → muestra menú
      if (!low || /hola|buenas|menu|ayuda/.test(low)) {
        await sendMainMenu(from);
        return res.sendStatus(200);
      }
    }

    // ====== Flujo RESERVA ======
    if (s.mode === "reserve") {
      if (!s.reserve.date) {
        s.reserve.date = txt;
        await sendReserveAsk(from, "time");
        return res.sendStatus(200);
      }
      if (!s.reserve.time) {
        s.reserve.time = txt;
        await sendReserveAsk(from, "people");
        return res.sendStatus(200);
      }
      if (!s.reserve.people) {
        s.reserve.people = txt;
        await sendReserveAsk(from, "name");
        return res.sendStatus(200);
      }
      if (!s.reserve.name) {
        s.reserve.name = txt;

        // Confirmación
        const conf =
          `✅ Reserva lista:\n` +
          `📅 ${s.reserve.date} – ⏰ ${s.reserve.time}\n` +
          `👥 ${s.reserve.people} – 👤 ${s.reserve.name}\n\n` +
          `¿Está correcto? (sí/no)`;
        await sendText(from, conf);
        return res.sendStatus(200);
      }

      // Post-confirmación
      if (/^si|sí|correcto|ok$/i.test(txt)) {
        await sendText(from, "¡Perfecto! Te esperamos. Si necesitas cambiar algo, avísanos.");
        s.mode = "idle";
        await sendMainMenu(from);
        return res.sendStatus(200);
      }
      if (/^no|cancel/i.test(txt)) {
        await sendText(from, "Reserva cancelada. ¿Quieres iniciar otra?");
        s.mode = "idle";
        await sendMainMenu(from);
        return res.sendStatus(200);
      }

      // Cualquier otra cosa: re-pedir confirmación
      await sendText(from, "Responde “sí” para confirmar o “no” para cancelar.");
      return res.sendStatus(200);
    }

    // ====== Flujo CERVEZA ======
    if (s.mode === "beer") {
      if (!s.beer.kind) {
        const low = txt.toLowerCase();
        if (/six|sixpack/.test(low)) s.beer.kind = "sixpack";
        else if (/20/.test(low)) s.beer.kind = "barril_20l";
        else if (/30/.test(low)) s.beer.kind = "barril_30l";
        else {
          await sendText(from, "No entendí el formato. Escribe: sixpack / barril 20 / barril 30.");
          return res.sendStatus(200);
        }
        await sendText(from, "¿Cuántas unidades deseas?");
        return res.sendStatus(200);
      }

      if (!s.beer.qty) {
        s.beer.qty = txt;
        await sendText(from, "¿Entrega o recogida en local?");
        return res.sendStatus(200);
      }

      if (!s.beer.delivery) {
        s.beer.delivery = txt;
        const priceUnit = PRICES[s.beer.kind] || 0;
        const total = (Number(s.beer.qty) * priceUnit).toFixed(2);

        const conf =
          `✅ Pedido:\n` +
          `🍺 ${s.beer.kind.replace("_", " ")} x ${s.beer.qty} = $${total}\n` +
          `🚚 ${s.beer.delivery}\n\n` +
          `¿Confirmamos? (sí/no)`;
        await sendText(from, conf);
        return res.sendStatus(200);
      }

      if (/^si|sí|correcto|ok$/i.test(txt)) {
        await sendText(from, "¡Listo! Preparamos tu pedido. Te escribimos si necesitamos un detalle más 😄");
        s.mode = "idle";
        await sendMainMenu(from);
        return res.sendStatus(200);
      }
      if (/^no|cancel/i.test(txt)) {
        await sendText(from, "Pedido cancelado. ¿Quieres ver otras opciones?");
        s.mode = "idle";
        await sendMainMenu(from);
        return res.sendStatus(200);
      }

      await sendText(from, "Responde “sí” para confirmar o “no” para cancelar.");
      return res.sendStatus(200);
    }

    // ====== Si no entró a ningún flujo, mantenemos ChatGPT (opcional) ======
    pushHistory(from, "user", txt);
    const systemPrompt = `
Eres el asistente de ${process.env.BUSINESS_NAME || "Casa Wayra"} en ${process.env.CITY || "Ibarra"}.
Si el usuario no está en un flujo, ayuda brevemente y sugiere el menú: Reservar, Promos o Cerveza.
Máximo 280 caracteres. Termina con una pregunta.
`.trim();

    let replyText = "¿Quieres reservar, ver promociones o pedir cerveza?";

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
          messages: [{ role: "system", content: systemPrompt }, ...s.history],
        }),
      });

      if (aiResp.ok) {
        const data = await aiResp.json();
        replyText = data.choices?.[0]?.message?.content || replyText;
      } else {
        console.error("OpenAI no OK:", await aiResp.text());
      }
    } catch (e) {
      console.error("OpenAI exception:", e);
    }

    pushHistory(from, "assistant", replyText);
    await sendText(from, replyText);
    await sendMainMenu(from);
    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error en webhook:", err);
    return res.sendStatus(200);
  }
});

/* =========================
   AI STATE
========================= */
const aiState = {
  greeted: false,
  isResponding: false,
  lastRequestId: 0,
  responseCache: new Map(),
};

/* =========================
   HELPERS
========================= */
function getAIElements() {
  return {
    chat: document.getElementById("aiChat"),
    input: document.getElementById("aiInput"),
    sendBtn: document.querySelector("#aiInputBox button"),
    box: document.getElementById("aiMessages"),
  };
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setInputBusy(busy) {
  const { input, sendBtn } = getAIElements();
  if (input) input.disabled = Boolean(busy);
  if (sendBtn) sendBtn.disabled = Boolean(busy);
}

function getResponseDelay(text, fromCache = false) {
  if (fromCache) return 70;
  const len = String(text || "").trim().length;
  if (len <= 20) return 140;
  if (len <= 70) return 230;
  return 320;
}

/* =========================
   TOGGLE CHAT
========================= */
function toggleAI() {
  const { chat, input, box } = getAIElements();
  if (!chat) return;

  const shouldOpen = chat.style.display !== "flex";
  chat.style.display = shouldOpen ? "flex" : "none";

  if (shouldOpen) {
    setTimeout(() => {
      if (input) input.focus();
    }, 20);

    if (!aiState.greeted && box && !box.children.length) {
      addMessage("Hello! I am your Roumyks assistant. Ask me about products, prices, payment, delivery, or support.", "bot");
      aiState.greeted = true;
    }
  }
}

/* =========================
   SEND MESSAGE
========================= */
function sendAI() {
  const { input } = getAIElements();
  if (!input || aiState.isResponding) return;

  const rawMsg = input.value.trim();
  if (!rawMsg) return;

  addMessage(rawMsg, "user");
  input.value = "";
  showTyping();

  aiState.isResponding = true;
  setInputBusy(true);

  const requestId = ++aiState.lastRequestId;
  const normalized = normalizeText(rawMsg);
  const cachedReply = aiState.responseCache.get(normalized);
  const reply = cachedReply || generateAIReply(normalized);

  if (!cachedReply) {
    aiState.responseCache.set(normalized, reply);
  }

  const delay = getResponseDelay(rawMsg, Boolean(cachedReply));
  setTimeout(() => {
    if (requestId !== aiState.lastRequestId) {
      return;
    }

    removeTyping();
    addMessage(reply, "bot");
    aiState.isResponding = false;
    setInputBusy(false);

    if (input) {
      input.focus();
    }
  }, delay);
}

/* =========================
   ADD MESSAGE
========================= */
function addMessage(text, type) {
  const { box } = getAIElements();
  if (!box) return;
  const div = document.createElement("div");

  div.className = `ai-message ${type}`;
  div.innerText = text;

  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

/* =========================
   TYPING INDICATOR
========================= */
function showTyping() {
  const { box } = getAIElements();
  if (!box) return;
  removeTyping();

  const div = document.createElement("div");
  div.className = "ai-message bot";
  div.id = "typing";
  div.innerText = "Typing...";
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function removeTyping() {
  const typing = document.getElementById("typing");
  if (typing) typing.remove();
}

/* =========================
   KNOWLEDGE BASE
========================= */
const knowledge = {
  brand: [
    "roumyks",
    "your website",
    "your company",
    "about you",
    "about roumyks",
  ],
  products: ["product", "products", "items", "sell"],
  topProduct: ["most buy", "most bought", "best seller", "top selling", "popular product"],
  prices: ["price", "prices", "cost", "how much"],
  payment: ["payment", "upi", "cod", "cash", "pay"],
  contact: ["contact", "support", "help", "email", "phone"],
  delivery: ["delivery", "shipping", "return", "refund"],
};

/* =========================
   INTENT MATCHER
========================= */
function matchIntent(text, keywords) {
  return keywords.some((k) => text.includes(k));
}

function hasAnyWord(text, words) {
  const t = normalizeText(text);
  return words.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(t);
  });
}

/* =========================
   AI RESPONSE ENGINE
========================= */
function generateAIReply(text) {
  const t = normalizeText(text);
  let reply = "";

  /* GREETING */
  if (hasAnyWord(t, ["hi", "hello", "hey", "namaste"])) {
    reply = aiState.greeted
      ? "😊 What would you like to know?"
      : "Hello 👋 Welcome to Roumyks! How can I help you today?";
    aiState.greeted = true;
  } else if (t.includes("waffle")) {
    /* PRODUCT PRICES */
    reply = "🧇 The Waffle Maker costs ₹499.";
  } else if (t.includes("moon")) {
    reply = "🌙 The 3D Moon Lamp costs ₹399.";
  } else if (t.includes("panda")) {
    reply = "🐼 The Panda Night Lamp costs ₹699.";
  } else if (t.includes("headphone") || t.includes("head phone") || t.includes("audio")) {
    reply = "🎧 The Headphone costs ₹899.";
  } else if (t.includes("galaxy")) {
    reply = "🌌 The Galaxy Projector costs ₹1299.";
  } else if (t.includes("aroma")) {
    reply = "🌿 The Aroma Diffuser costs ₹999.";
  } else if (t.includes("ear") || t.includes("muff")) {
    reply = "💡 The Ear Muffs costs ₹399.";
  } else if (
    matchIntent(t, knowledge.topProduct) ||
    (t.includes("most") && (t.includes("buy") || t.includes("bought"))) ||
    (t.includes("top") && t.includes("product"))
  ) {
    reply =
      "🔥 Most bought products right now:\n" +
      "• Headphone\n" +
      "• Galaxy Projector\n" +
      "• 3D Moon Lamp";
  } else if (matchIntent(t, knowledge.products)) {
    /* ALL PRODUCTS */
    reply =
      "📦 We currently offer:\n" +
      "• Headphone – ₹899\n" +
      "• Waffle Maker – ₹499\n" +
      "• 3D Moon Lamp – ₹399\n" +
      "• Panda Night Lamp – ₹699\n" +
      "• Ear Muffs – ₹399\n" +
      "• Galaxy Projector – ₹1299\n" +
      "• Aroma Diffuser – ₹999";
  } else if (matchIntent(t, knowledge.prices)) {
    /* PRICE RANGE */
    reply = "💰 Our prices range from ₹399 to ₹1299.";
  } else if (matchIntent(t, knowledge.payment)) {
    /* PAYMENT */
    reply =
      "💳 We accept UPI, Cash on Delivery, Net Banking, and Debit/Credit Cards.";
  } else if (matchIntent(t, knowledge.delivery)) {
    /* DELIVERY */
    reply =
      "🚚 PAN India delivery available with easy returns via trusted platforms.";
  } else if (matchIntent(t, knowledge.contact)) {
    /* CONTACT */
    reply = "📧 Email: support@roumyks.com\n📞 Phone: +91 98765 43210";
  } else if (matchIntent(t, knowledge.brand)) {
    /* BRAND */
    reply =
      "🏠 Roumyks offers stylish, affordable lifestyle & home products designed for everyday comfort.";
  } else if (hasAnyWord(t, ["thank", "thanks", "thx"])) {
    reply = "😊 You're welcome! I'm always here to help you.";
  } else if (hasAnyWord(t, ["bye", "goodbye", "later", "byy"]) || t.includes("see you")) {
    reply = "👋 Goodbye! Have a great day. Come back to Roumyks anytime!";
  } else {
    /* FALLBACK */
    reply =
      "🤖 I can help with products, prices, payment, delivery, or contact info.";
  }

  return reply;
}

function respondAI(text) {
  addMessage(generateAIReply(text), "bot");
}

/* =========================
   ENTER KEY SUPPORT
========================= */
const aiInputEl = document.getElementById("aiInput");
if (aiInputEl) {
  aiInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendAI();
    }
  });
}

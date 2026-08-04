const form = document.getElementById("chat-form");
const input = document.getElementById("message-input");
const messages = document.getElementById("messages");
const language = document.getElementById("language");
const newChatButton = document.querySelector(".new-chat");

const CHAT_STORAGE_KEY = "codepilot_chat_history";
const LANGUAGE_STORAGE_KEY = "codepilot_selected_language";

function createMessage(text, role) {
  const message = document.createElement("div");

  message.className = `message ${role}`;
  message.textContent = text;

  return message;
}

function getChatHistory() {
  const savedHistory = localStorage.getItem(CHAT_STORAGE_KEY);

  if (!savedHistory) {
    return [];
  }

  try {
    return JSON.parse(savedHistory);
  } catch {
    return [];
  }
}

function saveChatHistory(history) {
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(history));
}

function addMessage(text, role, saveMessage = true) {
  const message = createMessage(text, role);

  messages.appendChild(message);
  messages.scrollTop = messages.scrollHeight;

  if (saveMessage) {
    const history = getChatHistory();

    history.push({
      text: text,
      role: role
    });

    saveChatHistory(history);
  }

  return message;
}

function showWelcomeMessage() {
  messages.innerHTML = "";

  const welcomeMessage = createMessage(
    "Hello! Ask me a programming question.",
    "assistant"
  );

  messages.appendChild(welcomeMessage);
}

function loadSavedChat() {
  const history = getChatHistory();

  if (history.length === 0) {
    return;
  }

  messages.innerHTML = "";

  history.forEach((message) => {
    addMessage(message.text, message.role, false);
  });
}

function loadSavedLanguage() {
  const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);

  if (savedLanguage) {
    language.value = savedLanguage;
  }
}

function createNewChat() {
  localStorage.removeItem(CHAT_STORAGE_KEY);
  showWelcomeMessage();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const userMessage = input.value.trim();

  if (!userMessage) {
    return;
  }

  addMessage(userMessage, "user");

  input.value = "";
  input.disabled = true;

  const thinkingMessage = addMessage(
    "Thinking...",
    "assistant",
    false
  );

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: userMessage,
        language: language.value
      })
    });

    const data = await response.json();

    thinkingMessage.remove();
    addMessage(data.reply, "assistant");
  } catch {
    thinkingMessage.remove();
    addMessage("Could not connect to the backend.", "assistant");
  } finally {
    input.disabled = false;
    input.focus();
  }
});

language.addEventListener("change", () => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language.value);
});

if (newChatButton) {
  newChatButton.addEventListener("click", createNewChat);
}

loadSavedLanguage();
loadSavedChat();
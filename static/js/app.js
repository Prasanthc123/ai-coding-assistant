const form = document.getElementById("chat-form");
const input = document.getElementById("message-input");
const messages = document.getElementById("messages");
const language = document.getElementById("language");
const newChatButton = document.querySelector(".new-chat");
const sendButton = document.querySelector(".send-button");

const CHAT_STORAGE_KEY = "codepilot_chat_history";
const LANGUAGE_STORAGE_KEY = "codepilot_selected_language";

function createCodeCard(languageName, codeText) {
  const card = document.createElement("div");
  card.className = "code-card";

  const header = document.createElement("div");
  header.className = "code-card-header";

  const title = document.createElement("span");
  title.textContent = languageName || "Code";

  const copyButton = document.createElement("button");
  copyButton.className = "copy-button";
  copyButton.type = "button";
  copyButton.textContent = "Copy";

  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(codeText);
    copyButton.textContent = "Copied";

    setTimeout(() => {
      copyButton.textContent = "Copy";
    }, 1500);
  });

  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = codeText;

  header.append(title, copyButton);
  pre.appendChild(code);
  card.append(header, pre);

  return card;
}

function addNormalText(container, text) {
  const paragraphs = text.split(/\n{2,}/);

  paragraphs.forEach((paragraph) => {
    const cleanText = paragraph.trim();

    if (!cleanText) {
      return;
    }

    if (cleanText.startsWith("### ")) {
      const heading = document.createElement("h3");
      heading.textContent = cleanText.replace(/^### /, "");
      container.appendChild(heading);
      return;
    }

    const content = document.createElement("div");
    content.className = "normal-text";
    content.textContent = cleanText
      .replace(/\*\*/g, "")
      .replace(/`/g, "");

    container.appendChild(content);
  });
}

function renderAssistantMessage(messageElement, text) {
  messageElement.innerHTML = "";

  const sections = text.split("```");

  sections.forEach((section, index) => {
    if (index % 2 === 0) {
      addNormalText(messageElement, section);
      return;
    }

    const cleanSection = section.replace(/^\r?\n/, "");
    const lines = cleanSection.split("\n");

    let languageName = "Code";

    if (lines.length > 1 && /^[A-Za-z0-9+#.-]+$/.test(lines[0].trim())) {
      languageName = lines.shift().trim();
    }

    const codeText = lines.join("\n").trim();
    messageElement.appendChild(createCodeCard(languageName, codeText));
  });
}

function createMessage(text, role) {
  const message = document.createElement("div");
  message.className = `message ${role}`;

  if (role === "assistant") {
    renderAssistantMessage(message, text);
  } else {
    message.textContent = text;
  }

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

function saveMessage(text, role) {
  const history = getChatHistory();

  history.push({
    text: text,
    role: role
  });

  saveChatHistory(history);
}

function addMessage(text, role, saveToHistory = true) {
  const message = createMessage(text, role);

  messages.appendChild(message);
  messages.scrollTop = messages.scrollHeight;

  if (saveToHistory) {
    saveMessage(text, role);
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

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function setGeneratingState(isGenerating) {
  input.disabled = isGenerating;
  language.disabled = isGenerating;
  sendButton.disabled = isGenerating;

  if (isGenerating) {
    sendButton.textContent = "…";
    sendButton.title = "Generating response...";
  } else {
    sendButton.textContent = "↑";
    sendButton.title = "Send message";
  }
}

async function streamResponse(response, assistantMessage) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let fullResponse = "";
  let firstChunkReceived = false;

  while (true) {
    const result = await reader.read();

    if (result.done) {
      break;
    }

    const chunk = decoder.decode(result.value, {
      stream: true
    });

    if (!firstChunkReceived) {
      assistantMessage.textContent = "";
      firstChunkReceived = true;
    }

    fullResponse += chunk;
    assistantMessage.textContent = fullResponse;
    messages.scrollTop = messages.scrollHeight;
  }

  renderAssistantMessage(assistantMessage, fullResponse);

  return fullResponse;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const userMessage = input.value.trim();

  if (!userMessage || input.disabled) {
    return;
  }

  addMessage(userMessage, "user");

  input.value = "";
  resizeInput();
  setGeneratingState(true);

  const assistantMessage = addMessage(
    "Generating response...",
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

    if (!response.ok) {
      throw new Error("Unable to get a response from the server.");
    }

    const fullResponse = await streamResponse(
      response,
      assistantMessage
    );

    saveMessage(fullResponse, "assistant");
  } catch {
    assistantMessage.textContent =
      "Could not connect to the backend or Ollama.";

    saveMessage(
      "Could not connect to the backend or Ollama.",
      "assistant"
    );
  } finally {
    setGeneratingState(false);
    input.focus();
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();

    if (!input.disabled) {
      form.requestSubmit();
    }
  }
});

input.addEventListener("input", resizeInput);

language.addEventListener("change", () => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language.value);
});

if (newChatButton) {
  newChatButton.addEventListener("click", createNewChat);
}

loadSavedLanguage();
loadSavedChat();
resizeInput();
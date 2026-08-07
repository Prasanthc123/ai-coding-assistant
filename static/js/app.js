const form = document.getElementById("chat-form");
const input = document.getElementById("message-input");
const messages = document.getElementById("messages");
const language = document.getElementById("language");
const newChatButton = document.querySelector(".new-chat");
const sendButton = document.querySelector(".send-button");
const historyContainer = document.querySelector(".history-item");
const fileInput = document.getElementById("file-input");
const cameraInput = document.getElementById("camera-input");
const filePreview = document.getElementById("file-preview");
const previewFilename = document.getElementById("preview-filename");

const SESSIONS_KEY = "codepilot_chat_sessions";
const ACTIVE_SESSION_KEY = "codepilot_active_session";
const LANGUAGE_STORAGE_KEY = "codepilot_selected_language";
const ONE_DAY = 24 * 60 * 60 * 1000;
const TEN_DAYS = 10 * ONE_DAY;

let uploadedFile = null;

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

  const downloadButton = document.createElement("button");
  downloadButton.className = "copy-button";
  downloadButton.type = "button";
  downloadButton.textContent = "Download";

  downloadButton.addEventListener("click", () => {
    const extensions = {
      "Python": "py",
      "JavaScript": "js",
      "TypeScript": "ts",
      "Java": "java",
      "C": "c",
      "C++": "cpp",
      "C#": "cs",
      "Go": "go",
      "Rust": "rs",
      "PHP": "php",
      "Ruby": "rb",
      "Kotlin": "kt",
      "Swift": "swift",
      "Dart": "dart",
      "Scala": "scala",
      "R": "r",
      "MATLAB": "m",
      "SQL": "sql",
      "HTML and CSS": "html",
      "Bash": "sh",
      "Code": "txt"
    };

    const extension = extensions[languageName] || "txt";
    const filename = `code_${Date.now()}.${extension}`;

    const blob = new Blob([codeText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);

    downloadButton.textContent = "Downloaded";
    setTimeout(() => {
      downloadButton.textContent = "Download";
    }, 1500);
  });

  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = codeText;

  header.append(title, copyButton, downloadButton);
  pre.appendChild(code);
  card.append(header, pre);

  return card;
}

function renderAssistantMessage(messageElement, text) {
  messageElement.innerHTML = "";

  const sections = text.split("```");

  sections.forEach((section, index) => {
    if (index % 2 === 0) {
      const paragraphs = section.split(/\n{2,}/);

      paragraphs.forEach((paragraph) => {
        const content = paragraph.trim();

        if (!content) {
          return;
        }

        const block = document.createElement("div");
        block.className = "normal-text";
        block.textContent = content.replace(/\*\*/g, "").replace(/`/g, "");

        messageElement.appendChild(block);
      });

      return;
    }

    const lines = section.replace(/^\r?\n/, "").split("\n");
    let languageName = "Code";

    if (lines.length > 1 && /^[A-Za-z0-9+#.-]+$/.test(lines[0].trim())) {
      languageName = lines.shift().trim();
    }

    messageElement.appendChild(
      createCodeCard(languageName, lines.join("\n").trim())
    );
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

function loadSessions() {
  const savedSessions = localStorage.getItem(SESSIONS_KEY);

  if (!savedSessions) {
    return [];
  }

  try {
    return JSON.parse(savedSessions);
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function cleanExpiredSessions() {
  const sessions = loadSessions().filter((session) => {
    return Date.now() - session.createdAt < TEN_DAYS;
  });

  saveSessions(sessions);

  const activeId = localStorage.getItem(ACTIVE_SESSION_KEY);

  if (activeId && !sessions.some((session) => session.id === activeId)) {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }

  return sessions;
}

function getActiveSession() {
  const activeId = localStorage.getItem(ACTIVE_SESSION_KEY);

  return loadSessions().find((session) => session.id === activeId) || null;
}

function createSession(firstQuestion) {
  const session = {
    id: crypto.randomUUID(),
    title: firstQuestion.slice(0, 40),
    createdAt: Date.now(),
    language: language.value,
    messages: []
  };

  const sessions = cleanExpiredSessions();
  sessions.push(session);

  saveSessions(sessions);
  localStorage.setItem(ACTIVE_SESSION_KEY, session.id);

  return session;
}

function getOrCreateSession(firstQuestion) {
  const activeSession = getActiveSession();

  if (activeSession && Date.now() - activeSession.createdAt < ONE_DAY) {
    return activeSession;
  }

  return createSession(firstQuestion);
}

function saveMessage(text, role, firstQuestion = "") {
  const session = getOrCreateSession(firstQuestion);

  session.messages.push({
    text: text,
    role: role
  });

  session.language = language.value;

  const sessions = loadSessions().map((item) => {
    return item.id === session.id ? session : item;
  });

  saveSessions(sessions);
  renderHistory();
}

function addMessage(text, role, saveToHistory = true, firstQuestion = "") {
  const message = createMessage(text, role);

  messages.appendChild(message);
  messages.scrollTop = messages.scrollHeight;

  if (saveToHistory) {
    saveMessage(text, role, firstQuestion);
  }

  return message;
}

function showWelcomeMessage() {
  messages.innerHTML = "";
  messages.appendChild(
    createMessage("Hello! Upload code reference or describe what you need.", "assistant")
  );
}

function openSession(sessionId) {
  localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);

  const session = getActiveSession();

  messages.innerHTML = "";

  if (!session) {
    showWelcomeMessage();
    return;
  }

  language.value = session.language || "Python";

  session.messages.forEach((message) => {
    addMessage(message.text, message.role, false);
  });

  renderHistory();
}

function renderHistory() {
  const sessions = cleanExpiredSessions()
    .sort((first, second) => second.createdAt - first.createdAt);

  const activeId = localStorage.getItem(ACTIVE_SESSION_KEY);

  historyContainer.innerHTML = "";

  if (sessions.length === 0) {
    historyContainer.textContent = "No saved chats yet";
    return;
  }

  sessions.forEach((session) => {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = session.title;
    button.title = session.title;
    button.style.cssText = `
      width: 100%;
      margin: 0 0 8px;
      padding: 10px;
      border: 0;
      border-radius: 6px;
      background: ${session.id === activeId ? "#2563eb" : "transparent"};
      color: #e2e8f0;
      text-align: left;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;

    button.addEventListener("click", () => {
      openSession(session.id);
    });

    historyContainer.appendChild(button);
  });
}

function loadCurrentChat() {
  cleanExpiredSessions();

  const session = getActiveSession();

  if (!session) {
    showWelcomeMessage();
    return;
  }

  openSession(session.id);
}

function createNewChat() {
  localStorage.removeItem(ACTIVE_SESSION_KEY);
  uploadedFile = null;
  clearFilePreview();
  showWelcomeMessage();
  renderHistory();
  input.focus();
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function setGeneratingState(isGenerating) {
  input.disabled = isGenerating;
  language.disabled = isGenerating;
  sendButton.disabled = isGenerating;
  fileInput.disabled = isGenerating;
  cameraInput.disabled = isGenerating;
  sendButton.textContent = isGenerating ? "…" : "↑";
}

async function streamResponse(response, assistantMessage) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let fullResponse = "";
  let firstChunk = true;

  while (true) {
    const result = await reader.read();

    if (result.done) {
      break;
    }

    const chunk = decoder.decode(result.value, { stream: true });

    if (firstChunk) {
      assistantMessage.textContent = "";
      firstChunk = false;
    }

    fullResponse += chunk;
    assistantMessage.textContent = fullResponse;
    messages.scrollTop = messages.scrollHeight;
  }

  renderAssistantMessage(assistantMessage, fullResponse);

  return fullResponse;
}

function clearFilePreview() {
  uploadedFile = null;
  filePreview.style.display = "none";
  previewFilename.textContent = "file";
}

// ==================== FILE UPLOAD HANDLER ====================
fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  uploadedFile = file;
  previewFilename.textContent = file.name;
  filePreview.style.display = "flex";
  
  console.log("File attached:", file.name);
});

// ==================== CAMERA UPLOAD HANDLER ====================
cameraInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  uploadedFile = file;
  previewFilename.textContent = file.name;
  filePreview.style.display = "flex";
  
  console.log("Camera photo attached:", file.name);
});

// ==================== MAIN CHAT WITH FILE ====================
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const userMessage = input.value.trim();

  if (!userMessage && !uploadedFile) {
    alert("Enter a message or upload a file");
    return;
  }

  if (!userMessage && uploadedFile) {
    alert("Please describe what code you need");
    return;
  }

  addMessage(userMessage, "user", true, userMessage);

  input.value = "";
  resizeInput();
  setGeneratingState(true);

  const assistantMessage = addMessage(
    "Generating code...",
    "assistant",
    false
  );

  try {
    let prompt = userMessage;

    // If file is uploaded, send it for processing
    if (uploadedFile) {
      const formData = new FormData();
      formData.append("file", uploadedFile);

      try {
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData
        });

        if (!uploadRes.ok) {
          throw new Error("File upload failed");
        }

        const uploadData = await uploadRes.json();
        prompt = `${userMessage}\n\n[Document: ${uploadedFile.name}]`;
        console.log("File uploaded successfully:", uploadData);
      } catch (err) {
        console.error("Upload error:", err);
        prompt = userMessage + "\n[Note: File upload failed, using text only]";
      }

      uploadedFile = null;
      clearFilePreview();
    }

    // Send to chat API
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: prompt,
        language: language.value,
        use_documents: true
      })
    });

    if (!response.ok) {
      throw new Error("Chat request failed");
    }

    const answer = await streamResponse(response, assistantMessage);
    saveMessage(answer, "assistant");

  } catch (err) {
    const errorMessage = `Error: ${err.message || "Could not connect"}`;
    assistantMessage.textContent = errorMessage;
    saveMessage(errorMessage, "assistant");
  } finally {
    setGeneratingState(false);
    input.focus();
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", resizeInput);

language.addEventListener("change", () => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language.value);
});

newChatButton.addEventListener("click", createNewChat);

const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);

if (savedLanguage) {
  language.value = savedLanguage;
}

loadCurrentChat();
renderHistory();
resizeInput();

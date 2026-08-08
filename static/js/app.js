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
const MAX_SESSIONS = 50; // cap localStorage growth regardless of age

let uploadedFiles = [];
let activeDocId = null; // doc_id of the most recently uploaded file in the current conversation

form.noValidate = true;

// Maps our dropdown language names to highlight.js language identifiers.
const HLJS_LANGUAGE_MAP = {
  "Python": "python",
  "JavaScript": "javascript",
  "TypeScript": "typescript",
  "Java": "java",
  "C": "c",
  "C++": "cpp",
  "C#": "csharp",
  "Go": "go",
  "Rust": "rust",
  "PHP": "php",
  "Ruby": "ruby",
  "Kotlin": "kotlin",
  "Swift": "swift",
  "Dart": "dart",
  "Scala": "scala",
  "R": "r",
  "MATLAB": "matlab",
  "SQL": "sql",
  "HTML and CSS": "xml",
  "Bash": "bash",
  "Code": "plaintext"
};

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

  const normalizedName = Object.keys(HLJS_LANGUAGE_MAP).find(
    (key) => key.toLowerCase() === (languageName || "").toLowerCase()
  );
  const hljsLanguage = normalizedName
    ? HLJS_LANGUAGE_MAP[normalizedName]
    : (window.hljs && window.hljs.getLanguage(languageName?.toLowerCase())
        ? languageName.toLowerCase()
        : null);

  if (hljsLanguage) {
    code.classList.add(`language-${hljsLanguage}`);
  }

  header.append(title, copyButton, downloadButton);
  pre.appendChild(code);
  card.append(header, pre);

  if (window.hljs) {
    window.hljs.highlightElement(code);
  }

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
  const sessions = loadSessions()
    .filter((session) => Date.now() - session.createdAt < TEN_DAYS)
    .sort((first, second) => second.createdAt - first.createdAt)
    .slice(0, MAX_SESSIONS);

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
    lastDocId: null,
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

function setActiveDocId(docId) {
  activeDocId = docId;

  const activeId = localStorage.getItem(ACTIVE_SESSION_KEY);
  if (!activeId) {
    return;
  }

  const sessions = loadSessions().map((session) => {
    if (session.id === activeId) {
      return { ...session, lastDocId: docId };
    }
    return session;
  });

  saveSessions(sessions);
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
    activeDocId = null;
    showWelcomeMessage();
    return;
  }

  language.value = session.language || "Python";
  activeDocId = session.lastDocId || null;

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
  uploadedFiles = [];
  activeDocId = null;
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
  uploadedFiles = [];
  fileInput.value = "";
  cameraInput.value = "";
  filePreview.style.display = "none";
  previewFilename.textContent = "file";
}

// ==================== FILE UPLOAD HANDLER ====================
fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  uploadedFiles = files;
  previewFilename.textContent = files.map((f) => f.name).join(", ");
  filePreview.style.display = "flex";
  
  console.log("Files attached:", files.map((f) => f.name));
});

// ==================== CAMERA UPLOAD HANDLER ====================
cameraInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  uploadedFiles = files;
  previewFilename.textContent = files.map((f) => f.name).join(", ");
  filePreview.style.display = "flex";
  
  console.log("Camera photos attached:", files.map((f) => f.name));
});

// ==================== PASTE-TO-ATTACH (Ctrl+V a screenshot) ====================
input.addEventListener("paste", (event) => {
  const items = event.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (!file) continue;

      event.preventDefault(); // don't also paste raw image data as text

      const extension = item.type.split("/")[1] || "png";
      const namedFile = new File(
        [file],
        `pasted-screenshot-${Date.now()}.${extension}`,
        { type: item.type }
      );

      uploadedFiles = [namedFile];
      previewFilename.textContent = namedFile.name;
      filePreview.style.display = "flex";

      console.log("Image pasted from clipboard:", namedFile.name);
      break;
    }
  }
});

// ==================== MAIN CHAT WITH FILE(s) ====================
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const userMessage = input.value.trim();

  if (!userMessage && uploadedFiles.length === 0) {
    alert("Enter a message or upload a file");
    return;
  }

  // Allow file-only sends (e.g. screenshots with no typed question) by
  // falling back to a sensible default instruction for the model.
  const effectiveMessage =
    userMessage ||
    "Analyze the attached files and generate the complete, working code solution for them.";

  const fileNames = uploadedFiles.map((f) => f.name).join(", ");
  const displayMessage = userMessage || `[Attached: ${fileNames}]`;
  addMessage(displayMessage, "user", true, displayMessage);

  input.value = "";
  resizeInput();
  setGeneratingState(true);

  const assistantMessage = addMessage(
    "Generating code...",
    "assistant",
    false
  );

  try {
    let prompt = effectiveMessage;
    const docIds = [];

    // Upload all attached files and collect their doc_ids
    if (uploadedFiles.length > 0) {
      const names = uploadedFiles.map((f) => f.name).join(", ");
      prompt = `${effectiveMessage}\n\n[Documents: ${names}]`;

      for (const file of uploadedFiles) {
        const formData = new FormData();
        formData.append("file", file);

        try {
          const uploadRes = await fetch("/api/upload", {
            method: "POST",
            body: formData
          });

          if (!uploadRes.ok) {
            const errorBody = await uploadRes.json().catch(() => null);
            throw new Error(errorBody?.detail || `Upload failed for ${file.name}`);
          }

          const uploadData = await uploadRes.json();
          if (uploadData.doc_id) {
            docIds.push(uploadData.doc_id);
          }
          console.log("File uploaded successfully:", uploadData);
        } catch (err) {
          console.error("Upload error:", err);
          // Continue with remaining files; the final prompt still goes through
        }
      }
    }

    uploadedFiles = [];
    clearFilePreview();

    // Send to chat API
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: prompt,
        language: language.value,
        use_documents: true,
        doc_ids: docIds
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

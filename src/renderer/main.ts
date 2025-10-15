const app = document.getElementById("app");

if (!app) {
  throw new Error("No se encontró el elemento raíz #app");
}

if (!window.electronAPI) {
  throw new Error("electronAPI no está disponible en window");
}

app.innerHTML = `
  <main class="layout">
    <header class="header">
      <h1>Personal View (demo)</h1>
      <button id="refresh">Actualizar lista</button>
    </header>
    <section class="content">
      <article class="panel">
        <h2>Archivos disponibles</h2>
        <ul id="file-list" class="file-list"></ul>
      </article>
      <article class="panel">
        <h2>Progreso de carga simulado</h2>
        <div class="progress-wrapper">
          <div class="progress-label">
            <span>Progreso:</span>
            <span id="progress-value">0%</span>
          </div>
          <progress id="upload-progress" max="100" value="0"></progress>
        </div>
      </article>
      <article class="panel">
        <h2>Resultado de apertura</h2>
        <pre id="open-result">Selecciona un archivo para simular la apertura.</pre>
      </article>
    </section>
  </main>
`;

const fileList = document.getElementById("file-list") as HTMLUListElement;
const progressElement = document.getElementById("upload-progress") as HTMLProgressElement;
const progressValue = document.getElementById("progress-value")!;
const openResult = document.getElementById("open-result")!;
const refreshButton = document.getElementById("refresh") as HTMLButtonElement;

async function refreshFiles() {
  try {
    fileList.innerHTML = `<li class="file-item loading">Cargando...</li>`;
    const files = await window.electronAPI.listFiles();
    if (!files.length) {
      fileList.innerHTML = `<li class="file-item empty">No hay archivos disponibles.</li>`;
      return;
    }

    fileList.innerHTML = "";
    files.forEach((file) => {
      const item = document.createElement("li");
      item.className = "file-item";

      const name = document.createElement("span");
      name.textContent = file;

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.textContent = "Abrir";
      openButton.addEventListener("click", async () => {
        openButton.disabled = true;
        openButton.textContent = "Abriendo...";
        try {
          const result = await window.electronAPI.openFile(file);
          openResult.textContent = `Archivo: ${file}\nURL firmada: ${result}`;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          openResult.textContent = `Error al abrir ${file}: ${message}`;
        } finally {
          openButton.disabled = false;
          openButton.textContent = "Abrir";
        }
      });

      item.appendChild(name);
      item.appendChild(openButton);
      fileList.appendChild(item);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fileList.innerHTML = `<li class="file-item error">Error al listar archivos: ${message}</li>`;
  }
}

window.electronAPI.onUploadProgress((progress) => {
  const percentage = Math.round(progress * 100);
  progressElement.value = percentage;
  progressValue.textContent = `${percentage}%`;
});

refreshButton.addEventListener("click", () => {
  void refreshFiles();
});

void refreshFiles();

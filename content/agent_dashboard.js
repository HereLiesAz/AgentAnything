// content/agent_dashboard.js

const panel = document.createElement("div");
panel.style.position = "fixed";
panel.style.bottom = "20px";
panel.style.right = "20px";
panel.style.width = "300px";
panel.style.height = "200px";
panel.style.background = "#111";
panel.style.color = "#fff";
panel.style.zIndex = "999999";
panel.style.overflow = "auto";
panel.style.padding = "10px";
panel.innerText = "AgentAnything Network Monitor";

document.body.appendChild(panel);

window.addEventListener("message", (event) => {
  if (event.data?.source !== "AgentAnything") return;

  const entry = document.createElement("div");
  entry.style.fontSize = "10px";
  entry.style.marginBottom = "4px";

  if (event.data.type === "NETWORK_REQUEST") {
    entry.innerText = "REQ: " + event.data.payload.request.url;
  }

  if (event.data.type === "NETWORK_RESPONSE") {
    entry.innerText = "RES: " + event.data.payload.response.url;
  }

  panel.appendChild(entry);
});

panel.addEventListener("touchstart", () => {}, { passive: true });

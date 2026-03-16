const view = document.getElementById("view");

function show(text) {
  if (!view) {
    alert("view not found");
    return;
  }

  view.innerHTML = `
    <div class="card">
      <pre style="white-space: pre-wrap; margin: 0;">${text}</pre>
    </div>
  `;
}

try {
  show("app.js loaded");

  if (!window.supabase) {
    show("app.js loaded\nsupabase global: MISSING");
  } else if (typeof window.supabase.createClient !== "function") {
    show("app.js loaded\nsupabase.createClient: MISSING");
  } else {
    show("app.js loaded\nsupabase: OK");
  }
} catch (error) {
  show("app.js crash:\n" + (error && error.message ? error.message : String(error)));
}

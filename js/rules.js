
import {
  page, shell, getGuildContext, fetchAll, upsert, removeById, bindFormStatus, html, esc
} from "./lib.js";

page("Rules");
const root = document.getElementById("app");

function normalize(row, guildId) {
  const data = row || {};
  return {
    id: data.id ?? null,
    guild_id: guildId,
    rule_order: Number.isFinite(data.rule_order) ? data.rule_order : 0,
    title: data.title || "",
    content: data.content || "",
    enabled: data.enabled !== false
  };
}

async function render() {
  const ctx = await getGuildContext();
  if (!ctx) return;
  const { guild } = ctx;

  let rules = (await fetchAll("guild_rules", (q) => q.eq("guild_id", guild.guild_id).order("rule_order"))).map((x) => normalize(x, guild.guild_id));
  let selectedId = rules[0]?.id || "new";

  shell(root, {
    guild,
    active: "rules",
    title: `${guild.name} Rules`,
    subtitle: "Structured rules list with ordering, editing, and toggles.",
    content: html`
      <section class="card">
        <div class="split narrow">
          <div class="panel">
            <div class="section-title">
              <h3>Rules</h3>
              <div class="actions"><button id="createBtn">Add Rule</button></div>
            </div>
            <div id="rulesList" class="list"></div>
          </div>
          <div class="panel" id="editor"></div>
        </div>
      </section>
    `
  });

  const listEl = document.getElementById("rulesList");
  const editorEl = document.getElementById("editor");

  function current() {
    return selectedId === "new" ? normalize({}, guild.guild_id) : normalize(rules.find((x) => String(x.id) === String(selectedId)), guild.guild_id);
  }

  function renderList() {
    listEl.innerHTML = [
      `<button type="button" class="list-item ${selectedId === "new" ? "active" : ""}" data-id="new"><strong>+ New Rule</strong><span class="badge">Draft</span></button>`,
      ...rules.map((rule) => `
        <button type="button" class="list-item ${String(selectedId) === String(rule.id) ? "active" : ""}" data-id="${esc(rule.id)}">
          <div>
            <strong>#${esc(rule.rule_order)} ${esc(rule.title || "Untitled Rule")}</strong>
            <div class="item-meta">${esc((rule.content || "").slice(0, 90) || "No content yet")}</div>
          </div>
          <span class="badge ${rule.enabled ? "green" : "red"}">${rule.enabled ? "Enabled" : "Hidden"}</span>
        </button>
      `)
    ].join("");

    listEl.querySelectorAll("[data-id]").forEach((node) => {
      node.addEventListener("click", () => {
        selectedId = node.getAttribute("data-id");
        renderList();
        renderEditor();
      });
    });
  }

  function renderEditor() {
    const rule = current();
    editorEl.innerHTML = `
      <div class="section-title"><h3>${esc(rule.title || "Rule Editor")}</h3></div>
      <div class="row">
        <div class="field"><label>Order</label><input id="orderInput" type="number" step="1" value="${esc(rule.rule_order)}"></div>
        <label class="switch"><strong>Enabled</strong><input id="enabledInput" type="checkbox" ${rule.enabled ? "checked" : ""}></label>
      </div>
      <div style="height:12px"></div>
      <div class="field"><label>Title</label><input id="titleInput" value="${esc(rule.title)}"></div>
      <div style="height:12px"></div>
      <div class="field"><label>Rule text</label><textarea id="contentInput">${esc(rule.content)}</textarea></div>
      <div class="editor-footer">
        <div class="actions">
          <button id="saveBtn">Save</button>
          ${rule.id ? `<button class="danger" id="deleteBtn">Delete</button>` : ""}
        </div>
        <div class="status" id="status"></div>
      </div>
    `;
    const status = bindFormStatus(document.getElementById("status"));

    document.getElementById("saveBtn").addEventListener("click", async () => {
      try {
        const payload = {
          ...(rule.id ? { id: rule.id } : {}),
          guild_id: guild.guild_id,
          rule_order: Number(document.getElementById("orderInput").value || 0),
          title: document.getElementById("titleInput").value || "",
          content: document.getElementById("contentInput").value || "",
          enabled: !!document.getElementById("enabledInput").checked,
          updated_at: new Date().toISOString()
        };
        status.set("Saving...");
        await upsert("guild_rules", payload, rule.id ? "id" : undefined);
        rules = (await fetchAll("guild_rules", (q) => q.eq("guild_id", guild.guild_id).order("rule_order"))).map((x) => normalize(x, guild.guild_id));
        selectedId = rules.find((x) => x.title === payload.title && x.rule_order === payload.rule_order)?.id || rules[0]?.id || "new";
        renderList();
        renderEditor();
        status.set("Saved.", "success");
      } catch (error) {
        status.set(error.message || String(error), "error");
      }
    });

    const del = document.getElementById("deleteBtn");
    if (del) {
      del.addEventListener("click", async () => {
        if (!confirm("Delete this rule?")) return;
        try {
          await removeById("guild_rules", "id", rule.id);
          rules = rules.filter((x) => x.id !== rule.id);
          selectedId = rules[0]?.id || "new";
          renderList();
          renderEditor();
        } catch (error) {
          status.set(error.message || String(error), "error");
        }
      });
    }
  }

  document.getElementById("createBtn").addEventListener("click", () => {
    selectedId = "new";
    renderList();
    renderEditor();
  });

  renderList();
  renderEditor();
}

render().catch((error) => {
  root.innerHTML = `<div class="container"><section class="card"><h3>Ошибка</h3><p>${esc(error.message || String(error))}</p></section></div>`;
});

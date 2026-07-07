const themeKey = "jd-gallery-theme";
const cardGrid = document.querySelector("#cardGrid");
const statusEl = document.querySelector("#status");
const searchInput = document.querySelector("#searchInput");
const detailDialog = document.querySelector("#detailDialog");
const detailContent = document.querySelector("#detailContent");
const closeDialog = document.querySelector("#closeDialog");
const settingsToggle = document.querySelector("#settingsToggle");
const settingsPanel = document.querySelector("#settingsPanel");
const styleOptions = document.querySelectorAll(".style-option");

let jobs = [];
let query = "";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function compactText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function formatDate(value = "") {
  if (!value) return "";
  const normalized = value.replace(/\//g, "-");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}-${date.getDate()}`;
}

function applyTheme(theme) {
  const safeTheme = theme === "glass1" ? "glass1" : "base1";
  document.body.dataset.theme = safeTheme;
  localStorage.setItem(themeKey, safeTheme);
  styleOptions.forEach((button) => {
    button.classList.toggle("active", button.dataset.theme === safeTheme);
  });
}

function visibleJobs() {
  const needle = query.trim().toLowerCase();
  if (!needle) return jobs;
  return jobs.filter((job) => {
    const text = [
      job.title,
      job.company,
      job.company_short_name,
      job.salary,
      job.location,
      job.job_description,
      job.company_intro,
      job.business_info
    ].join(" ").toLowerCase();
    return text.includes(needle);
  });
}

function render() {
  const items = visibleJobs();
  statusEl.style.display = items.length ? "none" : "block";
  statusEl.textContent = jobs.length ? "没有匹配的岗位。" : "还没有岗位数据，先用插件保存一个 JD。";

  cardGrid.innerHTML = items.map((job) => {
    const displayCompany = job.company_short_name || job.company || "公司待识别";
    return `
    <article class="job-card" data-id="${job.id}" tabindex="0">
      <div class="card-cover">
        <div class="cover-content">
          <span class="salary">${escapeHtml(job.salary || "薪资待定")}</span>
          <h2>${escapeHtml(job.title || "未命名岗位")}</h2>
        </div>
      </div>
      <div class="card-body">
        <p class="company">${escapeHtml(displayCompany)}</p>
        <p class="desc">${escapeHtml(compactText(job.job_description || job.company_intro || ""))}</p>
        <div class="card-meta">
          <span class="location">${escapeHtml(job.location || "地点待定")}</span>
          <span class="date">${escapeHtml(formatDate(job.updated_at || job.created_at))}</span>
        </div>
      </div>
    </article>
  `;
  }).join("");
}

function openDetail(id) {
  const job = jobs.find((item) => String(item.id) === String(id));
  if (!job) return;
  const displayCompany = job.company_short_name || job.company || "公司待识别";

  detailContent.innerHTML = `
    <header class="detail-header">
      <h1>${escapeHtml(job.title || "未命名岗位")}</h1>
      <p class="detail-subtitle">
        ${escapeHtml(displayCompany)} · ${escapeHtml(job.salary || "薪资待定")} · ${escapeHtml(job.location || "地点待定")}
      </p>
      ${job.url ? `<a class="open-link" href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">打开原始岗位</a>` : ""}
    </header>

    <section class="detail-section">
      <h3>职位描述</h3>
      <p>${escapeHtml(job.job_description || "暂无职位描述")}</p>
    </section>

    <section class="detail-section">
      <h3>公司介绍</h3>
      <p>${escapeHtml(job.company_intro || "暂无公司介绍")}</p>
    </section>

    <section class="detail-section">
      <h3>工商信息</h3>
      <p>${escapeHtml(formatBusinessInfo(job))}</p>
    </section>
  `;
  detailDialog.showModal();
}

function formatBusinessInfo(job) {
  const shortName = job.company_short_name ? `公司简称\n${job.company_short_name}` : "";
  const businessInfo = job.business_info || "";
  if (!shortName) return businessInfo || "暂无工商信息";
  if (businessInfo.includes("公司简称")) return businessInfo;
  return `${shortName}\n${businessInfo}`.trim();
}

async function loadJobs() {
  try {
    const response = await fetch("/api/jobs");
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "读取失败");
    jobs = data.jobs || [];
    render();
  } catch (error) {
    statusEl.style.display = "block";
    statusEl.textContent = `读取失败：${error.message || error}`;
  }
}

cardGrid.addEventListener("click", (event) => {
  const card = event.target.closest(".job-card");
  if (card) openDetail(card.dataset.id);
});

cardGrid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const card = event.target.closest(".job-card");
  if (card) openDetail(card.dataset.id);
});

searchInput.addEventListener("input", (event) => {
  query = event.target.value;
  render();
});

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("open");
  settingsToggle.classList.toggle("active", settingsPanel.classList.contains("open"));
});

styleOptions.forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.theme));
});

closeDialog.addEventListener("click", () => detailDialog.close());

applyTheme(localStorage.getItem(themeKey) || "base1");
loadJobs();

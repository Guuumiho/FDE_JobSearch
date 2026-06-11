(function initJdCapture() {
  if (window.__jdCaptureMvpLoaded) return;
  window.__jdCaptureMvpLoaded = true;
  window.__jdCaptureAutomationStopped = false;

  const panel = document.createElement("div");
  panel.id = "jd-capture-mvp-panel";
  Object.assign(panel.style, {
    position: "fixed",
    right: "22px",
    bottom: "92px",
    zIndex: "2147483647",
    display: "grid",
    gap: "8px",
    width: "106px",
    font: "700 14px/1.2 system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
  });

  const startButton = createFloatingButton("开始", "#2563eb");
  startButton.title = "在右侧详情页查找并点击查看更多信息";
  startButton.setAttribute("aria-label", "开始打开详情动作");

  const stopButton = createFloatingButton("停止", "#475569");
  stopButton.title = "停止当前执行";
  stopButton.setAttribute("aria-label", "停止执行");

  const saveButton = createFloatingButton("保存JD", "#e94853");
  saveButton.id = "jd-capture-mvp-button";
  saveButton.title = "抓取当前页面岗位信息并保存到本地服务";
  saveButton.setAttribute("aria-label", "保存当前岗位信息");

  startButton.addEventListener("click", () => runOpenDetailAction(startButton));

  stopButton.addEventListener("click", () => {
    window.__jdCaptureAutomationStopped = true;
    setButtonState(startButton, "已停止", false);
    setTimeout(() => setButtonState(startButton, "开始", false), 1000);
  });

  saveButton.addEventListener("click", async () => {
    const originalText = saveButton.textContent;
    setButtonState(saveButton, "整理中", true);

    try {
      const job = collectJobInfo();
      await browser.runtime.sendMessage({ type: "saveJobToLocal", job });
      saveButton.textContent = "已保存";
    } catch (error) {
      console.error("[JD Capture MVP]", error);
      saveButton.textContent = "失败";
      alert(`保存失败：${error.message || error}\n\n请确认本地服务已启动：http://127.0.0.1:8765`);
    } finally {
      setTimeout(() => setButtonState(saveButton, originalText, false), 1600);
    }
  });

  panel.appendChild(startButton);
  panel.appendChild(stopButton);
  panel.appendChild(saveButton);
  document.documentElement.appendChild(panel);
})();

function createFloatingButton(text, background) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.dataset.bg = background;
  Object.assign(button.style, {
    width: "106px",
    height: "40px",
    border: "0",
    borderRadius: "999px",
    background,
    color: "#ffffff",
    boxShadow: "0 10px 28px rgba(0, 0, 0, 0.22)",
    cursor: "pointer",
    font: "700 14px/1.2 system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
  });
  button.addEventListener("mouseenter", () => {
    button.style.filter = "brightness(0.92)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.filter = "none";
  });
  return button;
}

function setButtonState(button, text, disabled) {
  button.textContent = text;
  button.disabled = disabled;
  button.style.opacity = disabled ? "0.75" : "1";
}

async function runOpenDetailAction(button) {
  window.__jdCaptureAutomationStopped = false;
  setButtonState(button, "执行中", true);

  try {
    const clicked = await openMoreInfoInDetailPane();
    if (window.__jdCaptureAutomationStopped) {
      setButtonState(button, "已停止", false);
    } else {
      setButtonState(button, clicked ? "已点击" : "未找到", false);
    }
  } catch (error) {
    console.error("[JD Capture MVP] open detail action failed", error);
    setButtonState(button, "失败", false);
    alert(`打开详情动作失败：${error.message || error}`);
  } finally {
    setTimeout(() => setButtonState(button, "开始", false), 1400);
  }
}

async function openMoreInfoInDetailPane() {
  const detailPane = findDetailScrollPane();
  if (!detailPane) {
    throw new Error("没有找到右侧岗位详情滚动区域，请先点击一个岗位打开详情页。");
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (window.__jdCaptureAutomationStopped) return false;

    const moreButton = findMoreInfoButton(detailPane);
    if (moreButton) {
      moreButton.scrollIntoView({ block: "center", inline: "nearest" });
      await sleep(220);
      moreButton.click();
      return true;
    }

    const previousScrollTop = detailPane.scrollTop;
    detailPane.scrollBy({
      top: Math.max(260, detailPane.clientHeight * 0.72),
      behavior: "smooth"
    });
    await sleep(420);

    if (isAtScrollBottom(detailPane) || Math.abs(detailPane.scrollTop - previousScrollTop) < 2) {
      const finalButton = findMoreInfoButton(detailPane);
      if (finalButton) {
        finalButton.scrollIntoView({ block: "center", inline: "nearest" });
        await sleep(220);
        finalButton.click();
        return true;
      }
      return false;
    }
  }

  return false;
}

function findDetailScrollPane() {
  const anchor = document.querySelector(
    ".job-detail-section, .job-sec-text, .sider-company, .job-detail, .job-detail-box, .job-detail-container, .job-detail-wrap, [class*='job-detail']"
  );
  if (!anchor) return null;

  const ancestors = [];
  let element = anchor;
  while (element && element !== document.body && element !== document.documentElement) {
    ancestors.push(element);
    element = element.parentElement;
  }

  const ancestorPane = ancestors.find((candidate) => isScrollableY(candidate) && isMostlyRightSide(candidate));
  if (ancestorPane) return ancestorPane;

  const rightScrollablePanes = Array.from(document.querySelectorAll("div, main, section, article"))
    .filter((candidate) => isScrollableY(candidate) && isMostlyRightSide(candidate))
    .sort((a, b) => {
      const aOverflow = a.scrollHeight - a.clientHeight;
      const bOverflow = b.scrollHeight - b.clientHeight;
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return bOverflow - aOverflow || bRect.left - aRect.left;
    });

  return rightScrollablePanes[0] || null;
}

function isScrollableY(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 20;
}

function isMostlyRightSide(element) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  return rect.width > 260 && centerX > window.innerWidth * 0.42;
}

function findMoreInfoButton(root) {
  const candidates = Array.from(root.querySelectorAll("a, button, div, span"))
    .filter((element) => normalizeLine(element.innerText || element.textContent) === "查看更多信息");
  return candidates.find(isClickableAndVisible) || null;
}

function isClickableAndVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) !== 0;
}

function isAtScrollBottom(element) {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectJobInfo() {
  const jdText = getBossJobDescription();
  const title =
    pickText([".job-title", ".detail-job-name", ".job-name", "h1", "[class*='job-title']", "[class*='jobName']"]) ||
    document.title ||
    "未命名岗位";
  const company = pickText([
    ".company-info .name",
    ".company-name",
    "[class*='company'] [class*='name']",
    "[class*='company-name']"
  ]);
  const salary = pickText([".salary", ".job-salary", "[class*='salary']"]);
  const location = pickText([".job-location", ".location", "[class*='location']", "[class*='city']"]);
  const fallbackDescription = jdText ? "" : extractLikelyDescription(getVisibleText(document.body));
  const businessInfo = getBusinessInfo();
  const companyShortName = getCompanyShortName();
  const legalCompanyName = parseBusinessInfoValue(businessInfo, "公司名称");
  const enrichedBusinessInfo = appendBusinessInfoValue(businessInfo, "公司简称", companyShortName);

  return {
    url: locationHref(),
    title: normalizeLine(title),
    company: normalizeLine(legalCompanyName || company),
    companyShortName: normalizeLine(companyShortName),
    salary: normalizeLine(salary),
    location: normalizeLine(location),
    description: jdText || fallbackDescription,
    companyIntro: getCompanyIntro(),
    businessInfo: enrichedBusinessInfo,
    capturedAt: new Date().toLocaleString()
  };
}

function locationHref() {
  try {
    return window.location.href;
  } catch {
    return "";
  }
}

function pickText(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const text = element && getVisibleText(element);
    if (text) return text;
  }
  return "";
}

function getBossJobDescription() {
  const selectors = [
    ".job-detail-section .job-sec-text",
    ".job-sec-text",
    ".job-detail .job-sec-text",
    "[class*='job-detail'] [class*='job-sec-text']"
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const text = getTextWithLineBreaks(element);
    if (text && text.length > 20) return cleanJobDescription(text);
  }

  return "";
}

function getCompanyIntro() {
  const selectors = [
    ".job-detail-section.job-detail-company .company-info-box .job-sec-text",
    ".job-detail-company .company-info-box .job-sec-text",
    ".company-info-box .job-sec-text"
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const text = getTextWithLineBreaks(element);
    if (text && text.length > 10) return cleanJobDescription(text);
  }

  return "";
}

function getCompanyShortName() {
  const selectors = [
    ".sider-company .company-info a[title]",
    ".sider-company .company-info a[ka='job-detail-company_custompage']",
    ".sider-company .company-info a[href*='/gongsi/']"
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const title = normalizeLine(element.getAttribute("title") || "");
    const text = normalizeLine(getTextWithLineBreaks(element));
    const value = title || text;
    if (value) return cleanJobDescription(value);
  }

  return "";
}

function getBusinessInfo() {
  const selectors = [
    ".job-detail-section.job-detail-company .business-info-box .level-list",
    ".job-detail-company .business-info-box .level-list",
    ".business-info-box .level-list"
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const items = Array.from(element.querySelectorAll("li"))
      .map((item) => getTextWithLineBreaks(item))
      .map((line) => line.replace(/^(公司名称|法定代表人|成立日期|企业类型|经营状态|注册资金)(?=\S)/, "$1："))
      .map(cleanJobDescription)
      .filter(Boolean);
    if (items.length) return items.join("\n");
  }

  return "";
}

function appendBusinessInfoValue(text, label, value) {
  const normalizedValue = normalizeLine(value);
  if (!normalizedValue) return text;
  const lines = (text || "").split("\n").map(normalizeLine).filter(Boolean);
  const hasLabel = lines.some((line) => line === label || line.startsWith(`${label}：`) || line.startsWith(`${label}:`));
  if (hasLabel) return text;
  return [...lines, label, normalizedValue].join("\n");
}

function parseBusinessInfoValue(text, label) {
  const lines = (text || "")
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === label) return lines[index + 1] || "";
    if (line.startsWith(`${label}：`) || line.startsWith(`${label}:`)) {
      return line.replace(new RegExp(`^${label}[:：]?\\s*`), "").trim();
    }
  }

  const line = lines.find((item) => item.startsWith(label));
  if (!line) return "";
  return line.replace(new RegExp(`^${label}[:：]?\\s*`), "").trim();
}

function getTextWithLineBreaks(root) {
  const renderedText = normalizeBlock(root.innerText || "");
  if (renderedText) return renderedText;

  const clone = root.cloneNode(true);
  clone.querySelectorAll("br").forEach((br) => {
    br.replaceWith(document.createTextNode("\n"));
  });
  clone.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
  return normalizeBlock(clone.textContent);
}

function getVisibleText(root) {
  if (!root) return "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue.replace(/\s+/g, " ").trim();
      if (!text) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const style = window.getComputedStyle(parent);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const lines = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = normalizeLine(node.nodeValue);
    if (text) lines.push(text);
  }

  return dedupeAdjacent(lines).join("\n");
}

function extractLikelyDescription(text) {
  const lines = text.split("\n").map(normalizeLine).filter(Boolean);
  const startWords = ["职位描述", "岗位职责", "职位详情", "工作内容", "职责描述", "任职要求", "岗位要求"];
  const stopWords = ["公司介绍", "工商信息", "相似职位", "推荐职位", "竞争力分析", "立即沟通"];
  const startIndex = lines.findIndex((line) => startWords.some((word) => line.includes(word)));

  if (startIndex === -1) {
    return lines.slice(0, 180).join("\n");
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (stopWords.some((word) => lines[index].includes(word))) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join("\n");
}

function normalizeLine(value) {
  return (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeBlock(value) {
  return (value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function cleanJobDescription(text) {
  const noiseLines = [
    "微信扫码分享",
    "举报",
    "职位描述"
  ];
  return removeAntiCopyNoise(text)
    .split("\n")
    .map(normalizeLine)
    .filter((line) => line && !noiseLines.includes(line))
    .join("\n");
}

function removeAntiCopyNoise(text) {
  return (text || "")
    .replace(/boss/gi, "")
    .replace(/kanzhun/gi, "")
    .replace(/BOSS直聘/g, "")
    .replace(/看准/g, "");
}

function dedupeAdjacent(lines) {
  const result = [];
  for (const line of lines) {
    if (line !== result[result.length - 1]) result.push(line);
  }
  return result;
}
